import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "bun:sqlite";
import type { z } from "zod";
import type { SqlExecutor, SqlValue, Transaction, UnitOfWork, MutationAdmission } from "@quire/contracts";
import { StorageError } from "./errors";

class Connection {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly scope = new AsyncLocalStorage<boolean>();
  private closing = false;
  private closed: Promise<void> | undefined;
  constructor(readonly native: Database, readonly admission?: MutationAdmission) {}
  enqueue<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.scope.getStore()) return Promise.reject(new StorageError("ROOT_SQL_IN_TRANSACTION", "Pass the callback executor to every helper"));
    if (this.closing) return Promise.reject(new StorageError("DATABASE_CLOSED", "Storage is closing"));
    const previous = this.tail;
    const execute = () => previous.then(work);
    const result = this.admission ? this.admission.writer(execute) : execute();
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.enqueue(() => this.scope.run(true, async () => {
      this.native.exec("BEGIN IMMEDIATE");
      const tx = new SqliteTransaction(this.native);
      try {
        const value = await work(tx);
        this.native.exec("COMMIT");
        return value;
      } catch (error) {
        this.native.exec("ROLLBACK");
        throw error;
      } finally { tx.finish(); }
    }));
  }
  close(): Promise<void> {
    if (this.scope.getStore()) return Promise.reject(new StorageError("ROOT_SQL_IN_TRANSACTION", "Close outside transactions"));
    if (!this.closed) {
      this.closing = true;
      this.closed = this.tail.then(() => { this.native.close(true); });
    }
    return this.closed;
  }
}
const connections = new WeakMap<Database, Connection>();
function connection(db: Database, admission?: MutationAdmission): Connection {
  let value = connections.get(db);
  if (!value) { value = new Connection(db, admission); connections.set(db, value); }
  return value;
}
abstract class Executor implements SqlExecutor {
  readonly dialect = "sqlite";
  abstract access<T>(work: (db: Database) => T): Promise<T>;
  get<T = Record<string, unknown>>(sql: string, parameters: readonly SqlValue[] = []): Promise<T | null> {
    return this.access((db) => {
      const statement = db.prepare<T, SqlValue[]>(sql);
      try { return statement.get(...parameters); } finally { statement.finalize(); }
    });
  }
  all<T = Record<string, unknown>>(sql: string, parameters: readonly SqlValue[] = []): Promise<readonly T[]> {
    return this.access((db) => {
      const statement = db.prepare<T, SqlValue[]>(sql);
      try { return statement.all(...parameters); } finally { statement.finalize(); }
    });
  }
  run(sql: string, parameters: readonly SqlValue[] = []): Promise<{ readonly changes: number }> {
    return this.access((db) => {
      const statement = db.prepare(sql);
      try { return { changes: statement.run(...parameters).changes }; } finally { statement.finalize(); }
    });
  }
  exec(sql: string): Promise<void> { return this.access((db) => { db.exec(sql); }); }
  async execute(sql: string, parameters: readonly SqlValue[] = []): Promise<number> {
    return (await this.run(sql, parameters)).changes;
  }
  async query<T extends z.ZodType>(sql: string, parameters: readonly SqlValue[], row: T): Promise<readonly z.output<T>[]> {
    return (await this.all<unknown>(sql, parameters)).map((value) => row.parse(value));
  }
}
class SqliteTransaction extends Executor implements Transaction {
  readonly transaction = true;
  private active = true;
  constructor(private readonly native: Database) { super(); }
  async access<T>(work: (db: Database) => T): Promise<T> {
    if (!this.active) throw new StorageError("TRANSACTION_CLOSED", "The callback executor cannot escape its transaction");
    return work(this.native);
  }
  async lock(_key: string): Promise<void> {
    // BEGIN IMMEDIATE already holds the native database writer lock.
    await this.access(() => undefined);
  }
  finish(): void { this.active = false; }
}
export class SqliteExecutor extends Executor {
  private readonly connection: Connection;
  constructor(native: Database, admission?: MutationAdmission) { super(); this.connection = connection(native, admission); }
  access<T>(work: (db: Database) => T): Promise<T> {
    return this.connection.enqueue(() => work(this.connection.native));
  }
  close(): Promise<void> { return this.connection.close(); }
}
export class SqliteUnitOfWork implements UnitOfWork {
  private readonly connection: Connection;
  constructor(native: Database) { this.connection = connection(native); }
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> { return this.connection.transaction(work); }
}
