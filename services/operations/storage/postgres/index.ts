import { AsyncLocalStorage } from "node:async_hooks";
import { SQL } from "bun";
import type { ReservedSQL } from "bun";
import type { z } from "zod";
import type { SqlExecutor, SqlResult, SqlValue, Transaction, UnitOfWork } from "@quire/contracts";
import { StorageError } from "@quire/runtime";
import { postgresPlaceholders } from "./placeholders";
import { PostgresMutationAdmission } from "./admission";

export { postgresPlaceholders } from "./placeholders";
export { PostgresMutationAdmission, admissionTicketSchema } from "./admission";
export type { AdmissionTicket } from "./admission";

export type PostgresOptions = {
  readonly url: string;
  readonly maxConnections?: number;
};
export type PostgresStorage = {
  readonly db: SqlExecutor;
  readonly uow: UnitOfWork;
  readonly admission: PostgresMutationAdmission;
  close(): Promise<void>;
};

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new StorageError("SQL_INTEGER_UNSAFE", value.toString());
    return number;
  }
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item: unknown) => normalize(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]: [string, unknown]) => [key, normalize(item)]));
  }
  return value;
}

abstract class Executor implements SqlExecutor {
  readonly dialect = "postgres";
  abstract access<T>(work: (sql: SQL) => Promise<T>): Promise<T>;
  async get<T = Record<string, unknown>>(sql: string, parameters: readonly SqlValue[] = []): Promise<T | null> {
    return (await this.all<T>(sql, parameters))[0] ?? null;
  }
  all<T = Record<string, unknown>>(sql: string, parameters: readonly SqlValue[] = []): Promise<readonly T[]> {
    return this.access(async (native) => {
      const rows = await native.unsafe<T[]>(postgresPlaceholders(sql, parameters.length), [...parameters]);
      for (const row of rows) {
        if (row !== null && typeof row === "object") {
          for (const [key, value] of Object.entries(row)) Reflect.set(row, key, normalize(value));
        }
      }
      return rows;
    });
  }
  run(sql: string, parameters: readonly SqlValue[] = []): Promise<SqlResult> {
    return this.access(async (native) => {
      const rows = await native.unsafe<unknown[] & { count: number }>(postgresPlaceholders(sql, parameters.length), [...parameters]);
      return { changes: rows.count };
    });
  }
  exec(sql: string): Promise<void> {
    return this.access(async (native) => { await native.unsafe(sql).simple(); });
  }
  async execute(sql: string, parameters: readonly SqlValue[] = []): Promise<number> {
    return (await this.run(sql, parameters)).changes;
  }
  async query<T extends z.ZodType>(sql: string, parameters: readonly SqlValue[], row: T): Promise<readonly z.output<T>[]> {
    return (await this.all<unknown>(sql, parameters)).map((value) => row.parse(value));
  }
}

class PostgresTransaction extends Executor implements Transaction {
  readonly transaction = true;
  private active = true;
  private tail: Promise<void> = Promise.resolve();
  private failure: { readonly error: unknown } | undefined;
  constructor(private readonly native: ReservedSQL) { super(); }
  access<T>(work: (sql: SQL) => Promise<T>): Promise<T> {
    if (!this.active) return Promise.reject(new StorageError("TRANSACTION_CLOSED", "The callback executor has expired"));
    const result = this.tail.then(() => work(this.native));
    this.tail = result.then(() => undefined, (error: unknown) => { this.failure ??= { error }; });
    return result;
  }
  async lock(key: string): Promise<void> {
    await this.all("SELECT pg_advisory_xact_lock(hashtextextended(?::text, 0))", [key]);
  }
  async finish(): Promise<void> {
    this.active = false;
    await this.tail;
    if (this.failure) throw this.failure.error;
  }
}

class PostgresConnection extends Executor implements UnitOfWork {
  private readonly scope = new AsyncLocalStorage<boolean>();
  private readonly pending = new Set<Promise<unknown>>();
  private closing = false;
  private closed: Promise<void> | undefined;
  constructor(private readonly native: SQL, readonly admission: PostgresMutationAdmission) { super(); }
  access<T>(work: (sql: SQL) => Promise<T>): Promise<T> { return this.admit(() => this.admission.connection(work)); }
  private admit<T>(work: () => Promise<T>): Promise<T> {
    if (this.scope.getStore()) return Promise.reject(new StorageError("ROOT_SQL_IN_TRANSACTION", "Pass the callback executor to every helper"));
    if (this.closing && !this.admission.active) return Promise.reject(new StorageError("DATABASE_CLOSED", "Storage is closing"));
    const result = Promise.resolve().then(work);
    this.pending.add(result);
    void result.then(() => this.pending.delete(result), () => this.pending.delete(result));
    return result;
  }
  run(sql: string, parameters?: readonly SqlValue[]): Promise<SqlResult>;
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  run<T>(sqlOrWork: string | ((tx: Transaction) => Promise<T>), parameters: readonly SqlValue[] = []): Promise<SqlResult | T> {
    if (typeof sqlOrWork === "string") return super.run(sqlOrWork, parameters);
    return this.admit(() => this.admission.connection(async reserved => this.scope.run(true, async () => {
      const tx = new PostgresTransaction(reserved);
        await reserved.unsafe("BEGIN").simple();
        try {
          const value = await sqlOrWork(tx);
          await tx.finish();
          await reserved.unsafe("COMMIT").simple();
          return value;
        } catch (error) {
          // Drain admitted statements before rollback, even if the callback threw.
          await tx.finish().catch(() => undefined);
          await reserved.unsafe("ROLLBACK").simple();
          throw error;
        }
    })));
  }
  close(): Promise<void> {
    if (this.scope.getStore()) return Promise.reject(new StorageError("ROOT_SQL_IN_TRANSACTION", "Close outside transactions"));
    if (!this.closed) {
      this.closing = true;
      this.closed = Promise.allSettled([...this.pending]).then(async () => {
        await this.admission.close();
        // All operations are drained. Bun 1.3.14 ignores timeout:0 and retains a
        // disconnected reservation in its pending count; bound only socket teardown.
        await this.native.close({ timeout: 1 });
      });
    }
    return this.closed;
  }
}

/** Owns a real Bun PostgreSQL pool. close drains admitted work and rejects new work. */
export async function createPostgresStorage(options: PostgresOptions): Promise<PostgresStorage> {
  const url = new URL(options.url);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new StorageError("POSTGRES_URL_REQUIRED", url.protocol);
  const pool = new SQL(options.url, {
    adapter: "postgres",
    bigint: true,
    max: options.maxConnections ?? 10,
    connection: { standard_conforming_strings: "on" },
  });
  const admission = new PostgresMutationAdmission(pool);
  const connection = new PostgresConnection(pool, admission);
  try {
    await connection.get("SELECT 1");
    return { db: connection, uow: connection, admission, close: () => connection.close() };
  } catch (error) {
    await connection.close();
    throw error;
  }
}
