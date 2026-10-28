import { AsyncLocalStorage } from "node:async_hooks";
import type { SQL, ReservedSQL } from "bun";
import { z } from "zod";
import type { MutationAdmission } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";

const key = 1364543813;
export const admissionTicketSchema = z.strictObject({
  pid: z.number().int().positive().brand<"PostgresBackendPid">(),
  name: z.string().uuid().brand<"AdmissionNonce">(), exclusive: z.boolean(),
});
export type AdmissionTicket = Readonly<z.infer<typeof admissionTicketSchema>>;
type Scope = {
  readonly sql: ReservedSQL; readonly ticket: AdmissionTicket;
  readonly children: Set<Promise<unknown>>;
  active: boolean; tail: Promise<void>;
};

async function release(sql: ReservedSQL, unlock: boolean): Promise<void> {
  try {
    // Bun 1.3.14's reserved connect() checks liveness without acquiring a new session.
    await sql.connect();
    if (unlock) await sql.unsafe("SELECT pg_advisory_unlock_all()");
    // release() returns a rejecting Promise on disconnect, despite older typings.
    await Promise.resolve(sql.release());
  } catch (error) {
    await sql.close();
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ERR_POSTGRES_CONNECTION_CLOSED") throw error;
    // A closed backend already released every session lock; it cannot be returned to the pool.
  }
}

/** The reserved session, never a renewable time lease, owns writer authority. */
export class PostgresMutationAdmission implements MutationAdmission {
  private readonly scope = new AsyncLocalStorage<Scope>();
  private readonly listeners = new Set<(phase: "closing" | "exclusive") => void>();
  private readonly pending = new Set<Promise<unknown>>();
  private closing = false;
  constructor(private readonly pool: SQL) {}

  get active(): boolean { return this.scope.getStore()?.active ?? false; }

  async close(): Promise<void> {
    if (this.active) throw new ServiceError("ADMISSION_REENTRANT", 409, "Close outside source operations");
    this.closing = true;
    await Promise.allSettled([...this.pending]);
    this.listeners.clear();
  }

  private async track<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) throw new ServiceError("DATABASE_CLOSED", 503, "Admission is closing");
    const result = work();
    this.pending.add(result);
    try { return await result; } finally { this.pending.delete(result); }
  }

  /** Observations are emitted after PostgreSQL has granted the corresponding gate. */
  subscribe(listener: (phase: "closing" | "exclusive") => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  ticket(): AdmissionTicket {
    const scope = this.scope.getStore();
    if (!scope?.active) throw new ServiceError("ADMISSION_REQUIRED", 409, "A live writer scope is required");
    return scope.ticket;
  }

  async valid(ticket: AdmissionTicket, sql: SQL = this.pool): Promise<boolean> {
    const rows = await sql.unsafe<{ valid: boolean }[]>(`SELECT EXISTS(
      SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE l.locktype='advisory' AND l.classid=$1 AND l.objid=1 AND l.objsubid=2
        AND l.granted AND l.pid=$2 AND a.application_name=$3 AND l.mode=$4
        AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
    ) AS valid`, [key, ticket.pid, `quire:${ticket.name}`, ticket.exclusive ? "ExclusiveLock" : "ShareLock"]);
    return rows[0]?.valid ?? false;
  }

  async writer<T>(work: () => Promise<T>): Promise<T> {
    const parent = this.scope.getStore();
    if (parent) {
      if (!parent.active) throw new ServiceError("ADMISSION_EXPIRED", 409, "The owning session has finished");
      const result = Promise.resolve().then(work);
      parent.children.add(result);
      try { return await result; } finally { parent.children.delete(result); }
    }
    return this.own(false, work);
  }

  background<T>(work: () => Promise<T>): Promise<T> {
    return this.scope.exit(() => this.own(false, work, true));
  }

  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.scope.getStore()) throw new ServiceError("BACKUP_REENTRANT", 409, "Backup cannot run inside writer admission");
    return this.own(true, work);
  }

  private own<T>(exclusive: boolean, work: () => Promise<T>, blocking = false): Promise<T> {
    return this.track(async () => {
      const sql = await this.pool.reserve();
      const name = crypto.randomUUID();
      try {
        await sql.unsafe("SELECT set_config('application_name',$1,false)", [`quire:${name}`]);
        if (exclusive) {
          await sql.unsafe("SELECT pg_advisory_lock($1,2)", [key]);
          for (const listener of this.listeners) listener("closing");
          await sql.unsafe("SELECT pg_advisory_lock($1,1)", [key]);
          for (const listener of this.listeners) listener("exclusive");
        } else {
          if (blocking) await sql.unsafe("SELECT pg_advisory_lock_shared($1,2)", [key]);
          else {
            const gate = await sql.unsafe<{ acquired: boolean }[]>(
              "SELECT pg_try_advisory_lock_shared($1,2) AS acquired", [key]);
            if (!gate[0]?.acquired) throw new ServiceError("BACKUP_MAINTENANCE", 503, "Source writes are paused for backup");
          }
          const acquired = await sql.unsafe<{ acquired: boolean }[]>(
            "SELECT pg_try_advisory_lock_shared($1,1) AS acquired", [key]);
          if (!acquired[0]?.acquired) throw new ServiceError("BACKUP_MAINTENANCE", 503, "Source writes are paused for backup");
          await sql.unsafe("SELECT pg_advisory_unlock_shared($1,2)", [key]);
        }
        const rows = await sql.unsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid");
        const ticket = admissionTicketSchema.parse({ pid: rows[0]?.pid, name, exclusive });
        return await this.run({ sql, ticket, active: true, tail: Promise.resolve(), children: new Set() }, work);
      } finally { await release(sql, true); }
    });
  }

  /** Repository work joins a live API authority, but is drained by its own host gate. */
  borrow<T>(ticket: AdmissionTicket, work: () => Promise<T>): Promise<T> {
    return this.track(async () => {
      if (!(await this.valid(ticket))) throw new ServiceError("ADMISSION_EXPIRED", 409, "The API writer session is no longer live");
      const sql = await this.pool.reserve();
      try {
        return await this.run({ sql, ticket, active: true, tail: Promise.resolve(), children: new Set() }, work);
      } finally { await release(sql, false); }
    });
  }

  private async run<T>(scope: Scope, work: () => Promise<T>): Promise<T> {
    let value: T;
    try { value = await this.scope.run(scope, work); }
    finally {
      while (scope.children.size) await Promise.allSettled([...scope.children]);
      scope.active = false;
      await scope.tail;
    }
    await scope.sql.connect();
    if (!(await this.valid(scope.ticket, scope.sql))) {
      throw new ServiceError("ADMISSION_EXPIRED", 409, "The owning session lost authority before operation completion");
    }
    return value;
  }

  connection<T>(work: (sql: ReservedSQL) => Promise<T>): Promise<T> {
    const scope = this.scope.getStore();
    if (!scope) return this.writer(() => this.connection(work));
    if (!scope.active) return Promise.reject(new ServiceError("ADMISSION_EXPIRED", 409, "The owning session has finished"));
    const result = scope.tail.then(async () => {
      await scope.sql.connect();
      if (!(await this.valid(scope.ticket, scope.sql))) throw new ServiceError("ADMISSION_EXPIRED", 409, "The writer session lost its lock");
      return work(scope.sql);
    });
    scope.tail = result.then(() => undefined, () => undefined);
    scope.children.add(result);
    void result.then(() => scope.children.delete(result), () => scope.children.delete(result));
    return result;
  }
}
