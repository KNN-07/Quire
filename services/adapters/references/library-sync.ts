import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id, LibraryEntry, Publication, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { singleRecord, parseBibtex } from "../../core/catalog/bibtex";
import { Library } from "../../core/catalog/library";
import type { HttpReceipt } from "../../core/base";
import { saveHttp } from "../../core/base/receipts";

export class ReferenceLibrary {
  constructor(readonly context: ModuleContext) {}
  async insert(tx: Transaction, input: {
    readonly actorId: Id; readonly publication: Publication; readonly readonly: boolean; readonly origin: "doi" | "provider";
  }): Promise<LibraryEntry> {
    if (!await tx.get("SELECT id FROM users WHERE id=? AND suspended=0 AND deleted_at IS NULL", [input.actorId])) {
      throw new ServiceError("UNAUTHENTICATED", 401, "Active account required");
    }
    const record = singleRecord(input.publication.bibtex);
    const previous = await tx.get<{ id: string }>(
      "SELECT id FROM library_entries WHERE owner_id=? AND citation_key=?", [input.actorId, record.citationKey]);
    if (previous) throw new ServiceError("CITATION_KEY_CONFLICT", 409, {
      message: `Citation key ${record.citationKey} already exists`, details: { entryId: previous.id } });
    const id = IdSchema.parse(crypto.randomUUID());
    const now = this.context.clock.now();
    await tx.run(`INSERT INTO library_entries
      (id,owner_id,citation_key,bibtex,origin,provider_id,readonly,publication_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [id, input.actorId, record.citationKey, input.publication.bibtex, input.origin,
      input.publication.providerId, Number(input.readonly), JSON.stringify(input.publication), now, now]);
    return new Library({ ...this.context, db: tx }).get(input.actorId, id);
  }
  async copy(input: { readonly actorId: Id; readonly publication: Publication; readonly origin: "doi" | "provider" }, receipt?: HttpReceipt) {
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:catalog");
      const entry = await this.insert(tx, { ...input, readonly: false });
      await saveHttp({ ...this.context, db: tx }, receipt, entry, entry.version);
      return entry;
    });
  }
  async sync(tx: Transaction, input: {
    readonly actorId: Id; readonly grantId: Id; readonly selection: string; readonly publications: readonly Publication[];
  }): Promise<void> {
    await tx.lock("quire:catalog");
    if (input.publications.length) parseBibtex(input.publications.map(item => item.bibtex).join("\n"));
    const mappings = await tx.all(`SELECT provider_id,library_id FROM reference_library_sources
      WHERE grant_id=? AND selection_key=?`, [input.grantId, input.selection]);
    const mapping = new Map(mappings.map(value => {
      const row = z.object({ provider_id: z.string(), library_id: IdSchema }).parse(value);
      return [row.provider_id, row.library_id];
    }));
    for (const publication of input.publications) {
      const existing = mapping.get(publication.providerId);
      const key = singleRecord(publication.bibtex).citationKey;
      if (existing) {
        const conflict = await tx.get("SELECT id FROM library_entries WHERE owner_id=? AND citation_key=? AND id<>?",
          [input.actorId, key, existing]);
        if (conflict) throw new ServiceError("CITATION_KEY_CONFLICT", 409, `Citation key ${key} belongs to another Library record`);
        await tx.run(`UPDATE library_entries SET citation_key=?,bibtex=?,publication_json=?,version=version+1,updated_at=?
          WHERE id=? AND owner_id=? AND readonly=1`,
        [key, publication.bibtex, JSON.stringify(publication), this.context.clock.now(), existing, input.actorId]);
        mapping.delete(publication.providerId);
      } else {
        const entry = await this.insert(tx, { actorId: input.actorId, publication, readonly: true, origin: "provider" });
        await tx.run("INSERT INTO reference_library_sources(grant_id,selection_key,provider_id,library_id) VALUES(?,?,?,?)",
          [input.grantId, input.selection, publication.providerId, entry.id]);
      }
    }
    for (const id of mapping.values()) await tx.run("DELETE FROM library_entries WHERE id=? AND owner_id=? AND readonly=1", [id, input.actorId]);
  }
}
