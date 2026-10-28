import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { AdapterDefinition, AdapterServices } from "../shared";
import { syncState } from "./model";
import { freshGrant } from "./authorization";
import { recoverDropbox } from "./recovery";

export type TickSource = { readonly subscribe: (listener: () => void) => () => void };
export class DropboxScheduler {
  private stop: (() => void) | null = null;
  private running: Promise<readonly { readonly grantId: string; readonly error: unknown }[]> | null = null;
  private closed = false;
  private failure: Error | null = null;
  private failures: readonly { readonly grantId: string; readonly error: unknown }[] = [];
  get lastFailure(): Error | null { return this.failure; }
  get lastFailures() { return this.failures; }
  constructor(private readonly services: AdapterServices, private readonly definition: AdapterDefinition) {}
  start(ticks: TickSource = { subscribe(listener) {
    const timer = setInterval(listener, 60_000); timer.unref();
    return () => clearInterval(timer);
  } }): void {
    if (this.closed) throw new TypeError("Dropbox scheduler is closed");
    if (this.stop) throw new TypeError("Dropbox scheduler already started");
    this.stop = ticks.subscribe(() => {
      void this.pump().catch(error => {
        if (!(error instanceof Error)) throw error;
        this.failure = error;
      });
    });
  }
  pump(): Promise<readonly { readonly grantId: string; readonly error: unknown }[]> {
    if (this.closed) return Promise.reject(new TypeError("Dropbox scheduler is closed"));
    if (this.running) return this.running;
    const run = this.run();
    this.running = run;
    void run.then(failures => { this.failures = failures; this.running = null; }, () => { this.running = null; });
    return run;
  }
  private async run() {
    const { context } = this.services;
    const recovered = await recoverDropbox(this.services, this.definition);
    const rows = await context.db.query(`SELECT s.*,g.owner_id,g.version FROM dropbox_sync s
      JOIN provider_grants g ON g.id=s.grant_id
      WHERE s.enabled=1 AND g.state='ready' AND s.next_at<=?
      AND NOT EXISTS(SELECT 1 FROM dropbox_retries r WHERE r.grant_id=s.grant_id
        AND r.project_id=s.project_id AND r.retry_at>?) ORDER BY s.grant_id,s.project_id`,
    [context.clock.now(), context.clock.now()], z.object({
      grant_id: IdSchema, project_id: IdSchema, owner_id: IdSchema, version: z.number(), state_json: z.string(),
    }));
    const failures: { readonly grantId: string; readonly error: unknown }[] = recovered.map(
      failure => ({ grantId: failure.grantId, error: failure.code }));
    for (const row of rows) {
      const state = syncState.parse(JSON.parse(row.state_json));
      const cursor = await context.db.get<{ cursor: string | null }>(
        "SELECT cursor FROM adapter_cursors WHERE grant_id=? AND action='sync' AND project_id=?", [row.grant_id, row.project_id]);
      try {
        const grant = await freshGrant(this.services, { actorId: row.owner_id, grantId: row.grant_id, projectId: row.project_id });
        await context.admission.background(() => this.services.operations.execute(this.definition, {
          actorId: row.owner_id, grantId: row.grant_id, projectId: row.project_id, expectedVersion: grant.version,
          expectedCursor: cursor?.cursor ?? null, action: "sync", key: crypto.randomUUID(),
          parameters: { branch: state.branch, generatedOutput: state.generated },
        }));
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        failures.push({ grantId: row.grant_id, error });
      }
    }
    return failures;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.stop?.(); this.stop = null;
    await this.running;
  }
}
