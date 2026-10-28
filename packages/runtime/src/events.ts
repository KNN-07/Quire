import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventSchema, EventPayloadSchemas, IdSchema } from "@quire/contracts";
import type { Event, EventTopic, Clock, Id, SqlExecutor, Transaction } from "@quire/contracts";

export type PendingEvent<T extends EventTopic = EventTopic> = {
  readonly [K in T]: {
    readonly topic: K; readonly aggregateId: Id;
    readonly payload: z.input<(typeof EventPayloadSchemas)[K]>;
  };
}[T];
export interface EventPort {
  record<T extends EventTopic>(tx: Transaction, event: PendingEvent<T>): Promise<Event>;
  read(seq: number, options?: { readonly aggregateId?: Id; readonly limit?: number }): Promise<readonly Event[]>;
  subscribe(listener: (event: Event) => void): () => void;
  dispatch(): Promise<void>;
  close(): Promise<void>;
}
const rowSchema = z.strictObject({
  seq: z.number().int().safe(), id: z.string(), topic: z.string(), aggregate_id: z.string(),
  at: z.string(), payload_json: z.string(),
});
function fromRow(row: unknown): Event {
  const value = rowSchema.parse(row);
  return EventSchema.parse({ seq: value.seq, id: value.id, topic: value.topic,
    aggregateId: value.aggregate_id, at: value.at, payload: JSON.parse(value.payload_json) });
}
/** Each process owns a cursor; published_at never suppresses another process's replay. */
export class SqliteEventPort implements EventPort {
  private readonly listeners = new Set<(event: Event) => void>();
  private cursor = 0;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly notify = AsyncLocalStorage.snapshot();
  constructor(private readonly db: SqlExecutor, private readonly clock: Clock) {}
  async record<T extends EventTopic>(tx: Transaction, input: PendingEvent<T>): Promise<Event> {
    const payload = EventPayloadSchemas[input.topic].parse(input.payload);
    const id = IdSchema.parse(crypto.randomUUID());
    const at = this.clock.now();
    // This transactional row lock is held through commit. Acquire after business locks.
    const rows = await tx.query("UPDATE event_counter SET value=value+1 WHERE id=1 RETURNING value", [],
      z.strictObject({ value: z.number().int().positive().safe() }));
    const [row] = z.tuple([z.strictObject({ value: z.number().int().positive().safe() })]).parse(rows);
    await tx.run("INSERT INTO events(seq,id,topic,aggregate_id,at,payload_json) VALUES(?,?,?,?,?,?)",
      [row.value, id, input.topic, input.aggregateId, at, JSON.stringify(payload)]);
    await tx.run("INSERT INTO outbox(event_seq) VALUES(?)", [row.value]);
    return EventSchema.parse({ seq: row.value, id, topic: input.topic, aggregateId: input.aggregateId, at, payload });
  }
  async read(seq: number, options: { readonly aggregateId?: Id; readonly limit?: number } = {}): Promise<readonly Event[]> {
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    const rows = options.aggregateId
      ? await this.db.all("SELECT * FROM events WHERE seq>? AND aggregate_id=? ORDER BY seq LIMIT ?", [seq, options.aggregateId, limit])
      : await this.db.all("SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?", [seq, limit]);
    return rows.map(fromRow);
  }
  subscribe(listener: (event: Event) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  dispatch(): Promise<void> {
    if (this.closed) return Promise.resolve();
    const result = this.tail.then(async () => {
      for (;;) {
        const events = await this.read(this.cursor, { limit: 200 });
        if (!events.length) return;
        for (const event of events) {
          // A durable notification starts independent follow-up work, never a continuation
          // of the request that happened to dispatch this outbox page.
          for (const listener of this.listeners) this.notify(listener, event);
          await this.db.run("UPDATE outbox SET published_at=?,attempts=attempts+1 WHERE event_seq=?",
            [this.clock.now(), event.seq]);
          this.cursor = event.seq;
        }
      }
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.tail;
    this.listeners.clear();
  }
}
