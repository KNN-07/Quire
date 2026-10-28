import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import { rm } from "node:fs/promises";
import { IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { policy, processRow, newId, poolId } from "./state";
import { launch, parseControllerConfig } from "./process";
import type { ControllerConfig, WorkerExit, WorkerProcess } from "./process";
import { finishOperation } from "./operations";
import { poolEnvironments, poolDirectory, roleDirectory, writeWorkerManifest } from "./profiles";

/** One serialized controller owns real processes; SQL authority fences every claim. */
export class WorkerController extends EventTarget {
  readonly owner = crypto.randomUUID();
  readonly processes = new Map<string, WorkerProcess>();
  private readonly pending = new Set<Promise<void>>();
  private tail: Promise<void> = Promise.resolve();
  private readonly inContext = AsyncLocalStorage.snapshot();
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private closing = false;
  private closed = false;
  private failure: unknown = null;
  readonly config: ControllerConfig;
  constructor(readonly context: ModuleContext, config: ControllerConfig) {
    super();
    this.config = parseControllerConfig(config);
  }
  async start(): Promise<void> {
    if (this.timer) return;
    const settings = await policy(this.context.db);
    if (settings.maximum > 0) await poolEnvironments(this.context, { backend: settings.sandbox,
      ...(this.config.environmentIds ? { ids: this.config.environmentIds } : {}) });
    await this.reconcile();
    this.unsubscribe = this.context.events.subscribe(event => {
      if (event.topic === "job.changed" || event.topic === "operation.changed") this.wake();
    });
    this.timer = setInterval(() => this.wake(), 2000);
  }
  private wake(): void {
    if (this.closing || this.failure) return;
    void this.reconcile().catch((error: unknown) => {
      this.failure = error;
      this.dispatchEvent(new Event("failure"));
    });
  }
  reconcile(): Promise<void> {
    return this.inContext(() => {
      const work = this.tail.then(() => this.context.admission.background(() => this.tick()));
      this.tail = work.then(() => undefined, () => undefined);
      return work;
    });
  }
  private async tick(): Promise<void> {
    if (this.closing) return;
    const { context } = this;
    const plan = await context.uow.run(async tx => {
      await tx.lock("quire:compiler");
      const now = context.clock.now();
      const current = z.object({ owner: z.string(), expires_at: z.string() }).nullable().parse(
        await tx.get("SELECT owner,expires_at FROM o_worker_controller WHERE id=1"));
      if (current && current.owner !== this.owner && Date.parse(current.expires_at) > Date.parse(now)) {
        throw new ServiceError("WORKER_CONTROLLER_CONFLICT", 409, "Another controller holds durable authority");
      }
      await tx.run(`INSERT INTO o_worker_controller(id,owner,expires_at) VALUES(1,?,?)
        ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at,
        generation=o_worker_controller.generation+CASE WHEN o_worker_controller.owner=excluded.owner THEN 0 ELSE 1 END`,
        [this.owner, new Date(Date.parse(now) + 10000).toISOString()]);
      await tx.run("UPDATE o_worker_policy SET managed=1 WHERE id=1");
      const settings = await policy(tx);
      const environments = settings.maximum === 0 ? [] : await poolEnvironments({ ...context, db: tx }, { backend: settings.sandbox,
        ...(this.config.environmentIds ? { ids: this.config.environmentIds } : {}) });
      const environmentIds = environments.map(environment => environment.id);
      const selection = JSON.stringify(environmentIds);
      const rows = z.array(processRow).parse(await tx.all(
        "SELECT * FROM o_worker_processes WHERE exited_at IS NULL AND desired<>'deleted' ORDER BY started_at,id"));
      // A new authority never adopts another controller's PIDs or signals a remote host.
      for (const row of rows.filter(item => item.owner !== this.owner)) {
        await tx.run("UPDATE o_worker_processes SET desired='draining',version=version+1 WHERE id=?", [row.id]);
        await tx.run("UPDATE workers SET state='offline' WHERE id=?", [row.id]);
      }
      const owned = rows.filter(row => row.owner === this.owner);
      const count = environmentIds.length === 0 ? { total: 0 } : z.object({ total: z.number() }).parse(await tx.get(
        `SELECT count(*) AS total FROM compile_jobs WHERE status IN ('queued','running')
          AND environment_id IN (${environmentIds.map(() => "?").join(",")})`, environmentIds));
      const desired = Math.min(settings.maximum, Math.max(settings.minimum, settings.requested, count.total));
      const running = owned.filter(row => row.desired === "running" && row.backend === settings.sandbox &&
        row.environment_ids_json === selection);
      const excess = owned.filter(row => row.desired === "running" && !running.some(item => item.id === row.id))
        .concat(running.slice(desired));
      for (const row of excess) await tx.run(
        "UPDATE o_worker_processes SET desired='draining',version=version+1 WHERE id=?", [row.id]);
      const stopping = owned.filter(row => row.desired !== "running" || excess.some(item => item.id === row.id));
      const stop = [];
      for (const row of stopping) {
        if (!await tx.get("SELECT job_id FROM worker_leases WHERE worker_id=?", [row.id])) stop.push(row);
      }
      // Draining processes still count toward the hard maximum until their exact exit.
      const spawn = Math.max(0, Math.min(desired - running.length, settings.maximum - owned.length));
      return { spawn, stop };
    });
    for (const row of plan.stop) {
      const child = this.processes.get(row.id);
      if (child) await child.stop();
    }
    for (let i = 0; i < plan.spawn; i++) await this.spawn();
    await this.completeRequests();
    await context.events.dispatch();
  }
  private async spawn(): Promise<void> {
    const id = newId();
    const admitted = await this.context.uow.run(async tx => {
      await tx.lock("quire:compiler");
      const current = z.object({ owner: z.string(), expires_at: z.string() }).parse(
        await tx.get("SELECT owner,expires_at FROM o_worker_controller WHERE id=1"));
      if (current.owner !== this.owner || Date.parse(current.expires_at) <= Date.parse(this.context.clock.now())) {
        throw new ServiceError("WORKER_CONTROLLER_CONFLICT", 409, "Controller lost launch authority");
      }
      const settings = await policy(tx);
      const count = z.object({ total: z.number() }).parse(await tx.get(
        "SELECT count(*) AS total FROM o_worker_processes WHERE owner=? AND exited_at IS NULL", [this.owner]));
      if (count.total >= settings.maximum) return null;
      const environments = await poolEnvironments({ ...this.context, db: tx }, { backend: settings.sandbox,
        ...(this.config.environmentIds ? { ids: this.config.environmentIds } : {}) });
      await tx.run(`INSERT INTO o_worker_processes(id,pool_id,owner,desired,started_at,backend,environment_ids_json)
        VALUES(?,?,?,'running',?,?,?)`, [id, poolId, this.owner, this.context.clock.now(), settings.sandbox,
        JSON.stringify(environments.map(environment => environment.id))]);
      return { environments, backend: settings.sandbox };
    });
    if (!admitted) return;
    const manifest = admitted.backend === "docker"
      ? await writeWorkerManifest(this.context, this.owner, { id, environments: admitted.environments }) : undefined;
    const child = await launch(id, { ...this.config, environmentIds: admitted.environments.map(environment => environment.id),
      ...(manifest ? { environmentsFile: manifest } : {}) });
    this.processes.set(id, child);
    await this.context.db.run("UPDATE o_worker_processes SET pid=? WHERE id=?", [child.pid, id]);
    const settled = child.exited.then(exit =>
      this.context.admission.background(() => this.exited(child, exit))).catch((error: unknown) => {
      this.failure = error;
      this.dispatchEvent(new Event("failure"));
    });
    this.pending.add(settled);
    void settled.finally(() => this.pending.delete(settled));
    this.dispatchEvent(new CustomEvent("spawn", { detail: { id, pid: child.pid, unit: child.unit } }));
  }
  private async exited(child: WorkerProcess, exit: WorkerExit): Promise<void> {
    try {
    const code = exit.code;
    const failed = exit.interrupted || code !== 0 && !exit.canceled;
    this.processes.delete(child.id);
    await this.context.uow.run(async tx => {
      await tx.lock("quire:compiler");
      const row = processRow.parse(await tx.get("SELECT * FROM o_worker_processes WHERE id=?", [child.id]));
      await tx.run(`UPDATE o_worker_processes SET pid=NULL,exited_at=?,exit_code=?,desired='stopped',
        version=version+1 WHERE id=?`, [this.context.clock.now(), code, child.id]);
      const jobs = await tx.all<{ job_id: string }>("SELECT job_id FROM worker_leases WHERE worker_id=?", [child.id]);
      for (const job of jobs) {
        await tx.run(`UPDATE compile_jobs SET status='failed',failure_code='WORKER_PROCESS_EXITED',
          finished_at=?,fencing_token=fencing_token+1,version=version+1 WHERE id=? AND status='running'`,
          [this.context.clock.now(), job.job_id]);
        await tx.run("DELETE FROM worker_leases WHERE job_id=?", [job.job_id]);
        await this.context.events.record(tx, { topic: "job.changed", aggregateId: IdSchema.parse(job.job_id),
          payload: { resourceId: IdSchema.parse(job.job_id), status: "failed" } });
      }
      await tx.run("UPDATE workers SET state='offline',job_id=NULL WHERE id=?", [child.id]);
      if (row.drain_operation) await finishOperation({ ...this.context, db: tx }, row.drain_operation, failed ? "WORKER_PROCESS_EXITED" : null);
      if (failed && !await tx.get("SELECT id FROM workers WHERE id=?", [child.id])) {
        const requests = z.array(z.object({ operation_id: IdSchema })).parse(await tx.all("SELECT operation_id FROM o_worker_requests"));
        for (const request of requests) {
          await finishOperation({ ...this.context, db: tx }, request.operation_id, "WORKER_START_FAILED");
          await tx.run("DELETE FROM o_worker_requests WHERE operation_id=?", [request.operation_id]);
        }
      }
    });
    await this.context.events.dispatch();
    await rm(roleDirectory(this.context, this.owner, child.id), { recursive: true, force: true });
    this.dispatchEvent(new CustomEvent("exit", { detail: { id: child.id, code } }));
    this.wake();
    } finally { await child.release?.(); }
  }
  private async completeRequests(): Promise<void> {
    await this.context.uow.run(async tx => {
      await tx.lock("quire:compiler");
      const registered = z.object({ total: z.number() }).parse(await tx.get(`SELECT count(*) AS total
        FROM o_worker_processes p JOIN workers w ON w.id=p.id
        WHERE p.owner=? AND p.desired='running' AND p.exited_at IS NULL AND w.last_heartbeat>?`,
        [this.owner, new Date(Date.parse(this.context.clock.now()) - 30000).toISOString()]));
      const requests = z.array(z.object({ operation_id: IdSchema, target: z.number() })).parse(
        await tx.all("SELECT * FROM o_worker_requests"));
      for (const request of requests) if (registered.total >= request.target) {
        await finishOperation({ ...this.context, db: tx }, request.operation_id, null);
        await tx.run("DELETE FROM o_worker_requests WHERE operation_id=?", [request.operation_id]);
      }
    });
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    await this.tail;
    for (const child of this.processes.values()) await child.stop();
    await Promise.all(this.pending);
    await rm(poolDirectory(this.context, this.owner), { recursive: true, force: true });
    await this.context.db.run("UPDATE o_worker_controller SET expires_at=? WHERE id=1 AND owner=?",
      [this.context.clock.now(), this.owner]);
    this.closed = true;
    if (this.failure) throw this.failure;
  }
}
