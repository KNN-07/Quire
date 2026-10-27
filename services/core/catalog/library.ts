import type { Id, LibraryEntry } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { libraryRow, newId, fail, compare } from "./storage";
import { parseBibtex, singleRecord } from "./bibtex";

export type LibraryInput = {
  readonly bibtex: string; readonly origin: LibraryEntry["origin"]; readonly providerId?: string | undefined;
};
export class Library {
  constructor(readonly context: ModuleContext) {}
  get(actorId: Id, id: Id): LibraryEntry {
    const row = this.context.db.query("SELECT * FROM library_entries WHERE owner_id=? AND id=?").get(actorId, id);
    if (!row) fail("NOT_FOUND", 404, "Library entry not found");
    return libraryRow(row);
  }
  list(actorId: Id): readonly LibraryEntry[] {
    return this.context.db.query("SELECT * FROM library_entries WHERE owner_id=? ORDER BY id").all(actorId).map(libraryRow);
  }
  create(actorId: Id, input: LibraryInput): LibraryEntry {
    const record = singleRecord(input.bibtex);
    const id = newId();
    const now = this.context.clock.now();
    this.context.db.query(`INSERT INTO library_entries
      (id,owner_id,citation_key,bibtex,origin,provider_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(id, actorId, record.citationKey, record.bibtex, input.origin, input.providerId ?? null, now, now);
    return this.get(actorId, id);
  }
  patch(actorId: Id, input: { readonly [K in keyof LibraryInput]?: LibraryInput[K] | undefined } & { readonly id: Id; readonly expectedVersion: number }): LibraryEntry {
    return this.context.uow.local(() => {
      const previous = this.get(actorId, input.id);
      if (previous.readonly) fail("READ_ONLY_BIBLIOGRAPHY", 403, "Linked bibliography records cannot be edited locally");
      compare(previous.version, input.expectedVersion);
      const record = singleRecord(input.bibtex ?? previous.bibtex);
      this.context.db.query(`UPDATE library_entries SET citation_key=?,bibtex=?,origin=?,provider_id=?,
        publication_json=NULL,version=version+1,updated_at=? WHERE id=? AND owner_id=?`)
        .run(record.citationKey, record.bibtex, input.origin ?? previous.origin, input.providerId ?? previous.providerId,
          this.context.clock.now(), previous.id, actorId);
      return this.get(actorId, previous.id);
    });
  }
  delete(actorId: Id, input: { readonly id: Id; readonly expectedVersion: number }) {
    return this.context.uow.local(() => {
      const entry = this.get(actorId, input.id);
      if (entry.readonly) fail("READ_ONLY_BIBLIOGRAPHY", 403, "Linked bibliography records cannot be deleted locally");
      compare(entry.version, input.expectedVersion);
      this.context.db.query("DELETE FROM library_entries WHERE id=? AND owner_id=?").run(entry.id, actorId);
      return { ok: true as const, version: entry.version + 1 };
    });
  }
  async import(actorId: Id, file: File): Promise<readonly LibraryEntry[]> {
    if (!file.name.toLowerCase().endsWith(".bib")) fail("UNSUPPORTED_UPLOAD", 422, "Upload a .bib file");
    if (file.size > 2 * 1024 * 1024) fail("UPLOAD_LIMIT", 413, "Bibliography exceeds 2 MiB");
    let source: string;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
    catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return fail("INVALID_BIBTEX", 422, "Bibliography must be UTF-8");
    }
    const records = parseBibtex(source);
    return this.context.uow.local(() => records.map(record => this.create(actorId, { bibtex: record.bibtex, origin: "manual" })));
  }
}
