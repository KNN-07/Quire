import { z } from "zod";
import { DigestSchema, GitOidSchema, IdSchema, ScopeSchema } from "@quire/contracts";
import type { BranchLease, Id, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects, sourceIntent } from "../../core/base";
import type { AdapterServices } from "../shared";

export const LinkStateSchema = z.object({
  id: IdSchema, grantId: IdSchema, ownerId: IdSchema, scope: ScopeSchema, fileId: IdSchema,
  selection: z.string(), digest: DigestSchema, cursor: z.string(), expectedVersion: z.number().int().nullable(),
});
export type LinkState = z.infer<typeof LinkStateSchema>;
export const JournalPayloadSchema = z.object({
  source: sourceIntent, link: LinkStateSchema, operationId: IdSchema, action: z.string(),
  grantVersion: z.number().int(), configVersion: z.number().int(), provider: z.string(),
  expectedCursor: z.string().nullable(), result: z.record(z.string(), z.json()),
});
export type JournalPayload = z.infer<typeof JournalPayloadSchema>;
export class ReferenceSourceJournal {
  constructor(readonly services: AdapterServices) {}
  async stage(id: Id, payload: JournalPayload) {
    await this.services.context.uow.run(async tx => {
      await tx.run(`INSERT INTO reference_source_journal(id,actor_id,grant_id,source_json,link_json,state,created_at)
        VALUES(?,?,?,?,?,'prepared',?)`, [id, payload.link.ownerId, payload.link.grantId,
        JSON.stringify(payload), JSON.stringify(payload.link), this.services.context.clock.now()]);
    });
  }
  async finalize(tx: Transaction, input: { readonly id: Id; readonly lease: BranchLease; readonly payload: JournalPayload }) {
    const { context } = this.services;
    const { payload, lease, id } = input;
    const { link } = payload;
    const service = new CoreProjects({ ...context, db: tx });
    await service.authorize(link.ownerId, link.scope, "owner");
    const current = await tx.get<{ version: number }>("SELECT version FROM reference_links WHERE id=?", [link.id]);
    if ((current?.version ?? null) !== link.expectedVersion) throw new ServiceError("REFERENCE_LINK_CONFLICT", 409, "Bibliography link changed");
    const events = await service.finalizePreparedSources(tx, { publication: { id, lease },
      sources: [{ source: payload.source, lease }] });
    await tx.run(`INSERT INTO reference_links
      (id,grant_id,owner_id,project_id,branch,file_id,selection_json,digest,cursor,version) VALUES(?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET digest=excluded.digest,cursor=excluded.cursor,version=reference_links.version+1`,
    [link.id, link.grantId, link.ownerId, link.scope.projectId, link.scope.branch, link.fileId, link.selection, link.digest, link.cursor]);
    for (const event of events) await context.events.record(tx, event);
    await tx.run("DELETE FROM reference_source_journal WHERE id=?", [id]);
  }
  async recover(): Promise<void> {
    const { context } = this.services;
    for (const row of await context.db.all("SELECT id,source_json FROM reference_source_journal ORDER BY created_at,id")) {
      const record = z.object({ id: IdSchema, source_json: z.string() }).parse(row);
      const payload = JournalPayloadSchema.parse(JSON.parse(record.source_json));
      const { link } = payload;
      const lease = await context.branches.acquire(link.scope, crypto.randomUUID(), 60_000);
      if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "Bibliography recovery branch busy");
      try {
        const grant = await this.services.grants.credentials(link.ownerId, link.grantId);
        const settings = await this.services.configuration.get(payload.provider);
        if (grant.grant.version !== payload.grantVersion || settings.version !== payload.configVersion || !settings.enabled) {
          throw new ServiceError("REFERENCE_RECOVERY_FENCED", 409, "Bibliography recovery needs original grant/configuration authority");
        }
        if (!await context.db.get("SELECT id FROM repository_intents WHERE id=?", [record.id])) {
          await context.repositories.publish({ id: record.id, lease, updates: [{
            ref: `refs/quire/history/${payload.source.snapshot.id}`, expected: null,
            next: GitOidSchema.parse(`sha1:${payload.source.commit}`),
          }] });
        } else await context.repositories.recover(record.id, lease);
        await context.uow.run(async tx => {
          await tx.lock("quire:accounts");
          await tx.lock(`adapter:provider:${payload.provider}`);
          await tx.lock(`adapter:grant:${link.grantId}`);
          const current = await this.services.grants.credentials(link.ownerId, link.grantId, tx);
          const config = await this.services.configuration.get(payload.provider, tx);
          if (current.grant.version !== payload.grantVersion || config.version !== payload.configVersion || !config.enabled) {
            throw new ServiceError("REFERENCE_RECOVERY_FENCED", 409, "Bibliography recovery authority changed");
          }
          const cursor = await tx.get<{ cursor: string | null }>(
            "SELECT cursor FROM adapter_cursors WHERE grant_id=? AND action=? AND project_id=?",
            [link.grantId, payload.action, link.scope.projectId]);
          if ((cursor?.cursor ?? null) !== payload.expectedCursor) throw new ServiceError("CURSOR_CONFLICT", 409, "Bibliography recovery cursor changed");
          await this.finalize(tx, { id: record.id, lease, payload });
          await tx.run(`INSERT INTO adapter_cursors(grant_id,action,project_id,cursor,version,updated_at)
            VALUES(?,?,?,?,1,?) ON CONFLICT(grant_id,action,project_id) DO UPDATE SET
            cursor=excluded.cursor,version=adapter_cursors.version+1,updated_at=excluded.updated_at`,
          [link.grantId, payload.action, link.scope.projectId, link.cursor, context.clock.now()]);
          await tx.run("UPDATE operations SET status='succeeded',progress=1,result_json=?,error_code=NULL,updated_at=?,version=version+1 WHERE id=?",
            [JSON.stringify(payload.result), context.clock.now(), payload.operationId]);
          await context.events.record(tx, { topic: "operation.changed", aggregateId: payload.operationId,
            payload: { resourceId: payload.operationId, status: "succeeded" } });
        });
        await context.events.dispatch();
      } finally { await context.branches.release(lease); }
    }
  }
}
