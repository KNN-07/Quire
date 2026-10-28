import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id, Transaction } from "@quire/contracts";
import type { AdapterServices, ActionContext } from "../shared";
import { sourceIntent } from "../../core/base";
import { syncState, parameters } from "./model";

export const journal = z.object({
  actorId: IdSchema, grantVersion: z.number(), configVersion: z.number(),
  key: z.string(), action: z.enum(["initialSync", "sync"]),
  parameters,
  source: sourceIntent.nullable(), state: syncState.nullable(),
  archived: z.boolean(),
  writes: z.array(z.object({ path: z.string(), revision: z.string().nullable(), hash: z.string().nullable() })),
});
export type SyncJournal = z.infer<typeof journal>;
export class DropboxStore {
  constructor(readonly services: AdapterServices) {}
  async read(grantId: Id, projectId: Id) {
    const row = await this.services.context.db.get<{ state_json: string; enabled: number; next_at: string }>(
      "SELECT * FROM dropbox_sync WHERE grant_id=? AND project_id=?", [grantId, projectId]);
    return row ? { state: syncState.parse(JSON.parse(row.state_json)), enabled: row.enabled === 1, nextAt: row.next_at } : null;
  }
  async pending(grantId: Id, projectId: Id): Promise<SyncJournal | null> {
    const row = await this.services.context.db.get<{ payload_json: string }>(
      "SELECT payload_json FROM dropbox_journal WHERE grant_id=? AND project_id=?", [grantId, projectId]);
    return row ? journal.parse(JSON.parse(row.payload_json)) : null;
  }
  async save(input: { readonly context: ActionContext; readonly projectId: Id; readonly journal: SyncJournal }) {
    await this.services.context.uow.run(async tx => {
      await tx.lock(`dropbox:${input.context.grant.id}:${input.projectId}`);
      await tx.run(`INSERT INTO dropbox_journal(grant_id,project_id,payload_json) VALUES(?,?,?)
        ON CONFLICT(grant_id,project_id) DO UPDATE SET payload_json=excluded.payload_json`,
      [input.context.grant.id, input.projectId, JSON.stringify(input.journal)]);
    });
  }
  async finish(tx: Transaction, input: {
    readonly grantId: Id; readonly projectId: Id; readonly state: z.infer<typeof syncState>;
  }) {
    const next = new Date(Date.parse(this.services.context.clock.now()) + 15 * 60_000).toISOString();
    await tx.run(`INSERT INTO dropbox_sync(grant_id,project_id,state_json,enabled,next_at) VALUES(?,?,?,1,?)
      ON CONFLICT(grant_id,project_id) DO UPDATE SET state_json=excluded.state_json,enabled=1,next_at=excluded.next_at`,
    [input.grantId, input.projectId, JSON.stringify(input.state), next]);
    await tx.run("DELETE FROM dropbox_journal WHERE grant_id=? AND project_id=?", [input.grantId, input.projectId]);
    await tx.run("DELETE FROM dropbox_retries WHERE grant_id=? AND project_id=?", [input.grantId, input.projectId]);
  }
}
