import type { Id, LibraryEntry, Transaction } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { HttpReceipt } from "../base";
import { saveHttp } from "../base/receipts";
import { libraryRow, newId, fail, compare } from "./storage";
import { parseBibtex, singleRecord } from "./bibtex";

export type LibraryInput = {
  readonly bibtex: string; readonly origin: LibraryEntry["origin"]; readonly providerId?: string | undefined;
};
export class Library {
  constructor(readonly context: ModuleContext) {}
  async get(actorId: Id, id: Id): Promise<LibraryEntry> {
    const row = await this.context.db.get("SELECT * FROM library_entries WHERE owner_id=? AND id=?", [actorId, id]);
    if (!row) fail("NOT_FOUND", 404, "Library entry not found");
    return libraryRow(row);
  }
  async list(actorId: Id): Promise<readonly LibraryEntry[]> {
    return (await this.context.db.all("SELECT * FROM library_entries WHERE owner_id=? ORDER BY id", [actorId])).map(libraryRow);
  }
  private async insert(tx: Transaction, actorId: Id, input: LibraryInput): Promise<LibraryEntry> {
    const record = singleRecord(input.bibtex);
    const id = newId();
    const now = this.context.clock.now();
    await tx.run(`INSERT INTO library_entries
      (id,owner_id,citation_key,bibtex,origin,provider_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
      [id, actorId, record.citationKey, record.bibtex, input.origin, input.providerId ?? null, now, now]);
    return new Library({ ...this.context, db: tx }).get(actorId, id);
  }
  async create(actorId: Id, input: LibraryInput, receipt?: HttpReceipt): Promise<LibraryEntry> {
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:catalog");
      const entry = await this.insert(tx, actorId, input);
      await saveHttp({ ...this.context, db: tx }, receipt, entry, entry.version);
      return entry;
    });
  }
  async patch(actorId: Id, input: { readonly [K in keyof LibraryInput]?: LibraryInput[K] | undefined } & { readonly id: Id; readonly expectedVersion: number }): Promise<LibraryEntry> {
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:catalog");
      const service = new Library({ ...this.context, db: tx });
      const previous = await service.get(actorId, input.id);
      if (previous.readonly) fail("READ_ONLY_BIBLIOGRAPHY", 403, "Linked bibliography records cannot be edited locally");
      compare(previous.version, input.expectedVersion);
      const record = singleRecord(input.bibtex ?? previous.bibtex);
      await tx.run(`UPDATE library_entries SET citation_key=?,bibtex=?,origin=?,provider_id=?,
        publication_json=NULL,version=version+1,updated_at=? WHERE id=? AND owner_id=?`,
        [record.citationKey, record.bibtex, input.origin ?? previous.origin, input.providerId ?? previous.providerId,
          this.context.clock.now(), previous.id, actorId]);
      return service.get(actorId, previous.id);
    });
  }
  async delete(actorId: Id, input: { readonly id: Id; readonly expectedVersion: number }) {
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:catalog");
      const entry = await new Library({ ...this.context, db: tx }).get(actorId, input.id);
      if (entry.readonly) fail("READ_ONLY_BIBLIOGRAPHY", 403, "Linked bibliography records cannot be deleted locally");
      compare(entry.version, input.expectedVersion);
      await tx.run("DELETE FROM library_entries WHERE id=? AND owner_id=?", [entry.id, actorId]);
      return { ok: true as const, version: entry.version + 1 };
    });
  }
  async import(actorId: Id, file: File, receipt?: HttpReceipt): Promise<readonly LibraryEntry[]> {
    if (!file.name.toLowerCase().endsWith(".bib")) fail("UNSUPPORTED_UPLOAD", 422, "Upload a .bib file");
    if (file.size > 2 * 1024 * 1024) fail("UPLOAD_LIMIT", 413, "Bibliography exceeds 2 MiB");
    let source: string;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
    catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return fail("INVALID_BIBTEX", 422, "Bibliography must be UTF-8");
    }
    const records = parseBibtex(source);
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:catalog");
      const entries = [];
      for (const record of records) entries.push(await this.insert(tx, actorId, { bibtex: record.bibtex, origin: "manual" }));
      await saveHttp({ ...this.context, db: tx }, receipt, entries, null);
      return entries;
    });
  }
}
