import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { AdapterDefinition, AdapterServices } from "../shared";
import { ZoteroSelectionSchema } from "./zotero";
import type { ZoteroSelection } from "./zotero";

export type SyncTicker = { readonly subscribe: (tick: () => void) => () => void };
export const periodicSyncTicker: SyncTicker = {
  subscribe(tick) { const timer = setInterval(tick, 30_000); timer.unref(); return () => clearInterval(timer); },
};
export class ReferenceScheduler {
  private stop: (() => void) | undefined;
  private running: Promise<void> | undefined;
  private failure: Error | undefined;
  constructor(readonly services: AdapterServices, readonly definition: AdapterDefinition) {}
  async configure(actorId: Id, input: {
    readonly grantId: Id; readonly selection: ZoteroSelection; readonly intervalMs: number | null;
  }) {
    const selection = JSON.stringify(ZoteroSelectionSchema.parse(input.selection));
    if (input.intervalMs !== null) z.number().int().min(900_000).max(86_400_000).parse(input.intervalMs);
    await this.services.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const { grant } = await this.services.grants.credentials(actorId, input.grantId, tx);
      if (grant.provider !== "zotero") throw new ServiceError("GRANT_PROVIDER_MISMATCH", 400, "Collection schedules require Zotero");
      if (input.intervalMs === null) {
        await tx.run("DELETE FROM reference_schedules WHERE actor_id=? AND grant_id=? AND selection_json=?", [actorId, grant.id, selection]);
        return;
      }
      await tx.run(`INSERT INTO reference_schedules(id,actor_id,grant_id,selection_json,interval_ms,due_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(grant_id,selection_json) DO UPDATE SET
        interval_ms=excluded.interval_ms,due_at=excluded.due_at,version=reference_schedules.version+1,last_error=NULL`,
      [crypto.randomUUID(), actorId, grant.id, selection, input.intervalMs,
        new Date(Date.parse(this.services.context.clock.now()) + input.intervalMs).toISOString()]);
    });
  }
  start(ticker: SyncTicker = periodicSyncTicker): void {
    if (this.stop) throw new ServiceError("SCHEDULER_ALREADY_STARTED", 409, "Reference scheduler is already started");
    this.stop = ticker.subscribe(() => {
      void this.runDue().then(undefined, error => {
        this.failure = error instanceof Error ? error : new TypeError("Reference scheduler rejected with a non-error value");
      });
    });
  }
  runDue(): Promise<void> {
    if (this.running) return this.running;
    const work = this.services.context.admission.background(() => this.tick());
    this.running = work;
    void work.then(() => { this.running = undefined; }, () => { this.running = undefined; });
    return work;
  }
  private async tick(): Promise<void> {
    const { context, grants, operations } = this.services;
    const rows = await context.db.all("SELECT * FROM reference_schedules WHERE due_at<=? ORDER BY due_at,id", [context.clock.now()]);
    for (const value of rows) {
      const row = z.object({ id: IdSchema, actor_id: IdSchema, grant_id: IdSchema, selection_json: z.string(),
        due_at: z.string(), version: z.number().int(), interval_ms: z.number().int() }).parse(value);
      let failure: string | null = null;
      try {
        const grant = await grants.read(row.actor_id, row.grant_id);
        const cursor = await context.db.get<{ cursor: string | null }>("SELECT cursor FROM adapter_cursors WHERE grant_id=? AND action='librarySync' AND project_id=''", [row.grant_id]);
        await operations.execute(this.definition, { actorId: row.actor_id, grantId: row.grant_id,
          action: "librarySync", expectedVersion: grant.version, expectedCursor: cursor?.cursor ?? null,
          key: `references:${row.id}:${row.due_at}`, parameters: z.record(z.string(), z.json()).parse({
            selection: ZoteroSelectionSchema.parse(JSON.parse(row.selection_json)) }) });
      } catch (error) {
        if (error instanceof ServiceError) failure = error.code;
        else if (error instanceof z.ZodError) failure = "INVALID_SCHEDULE";
        else throw error;
      }
      await context.uow.run(async tx => {
        await tx.run(`UPDATE reference_schedules SET due_at=?,last_error=?,version=version+1 WHERE id=? AND version=?`,
          [new Date(Date.parse(context.clock.now()) + row.interval_ms).toISOString(), failure, row.id, row.version]);
      });
    }
  }
  async close(): Promise<void> {
    this.stop?.(); this.stop = undefined;
    await this.running;
    if (this.failure) throw this.failure;
  }
}
