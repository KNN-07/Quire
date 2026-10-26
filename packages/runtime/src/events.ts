import type { Database } from "bun:sqlite";
import { z } from "zod";
import { EventSchema, EventPayloadSchemas, IdSchema } from "@quire/contracts";
import type { Event, EventTopic, Clock, Id } from "@quire/contracts";
import type { Transaction } from "./database";

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
}
export interface LocalEventPort extends EventPort {
  append<T extends EventTopic>(tx: Database, event: PendingEvent<T>): Event;
  after(seq: number, options?: { readonly aggregateId?: Id; readonly limit?: number }): readonly Event[];
  dispatch(): void;
}
const rowSchema = z.strictObject({
  seq: z.number(), id: z.string(), topic: z.string(), aggregate_id: z.string(),
  at: z.string(), payload_json: z.string(),
});
function fromRow(row: unknown): Event {
  const value = rowSchema.parse(row);
  return EventSchema.parse({ seq: value.seq, id: value.id, topic: value.topic,
    aggregateId: value.aggregate_id, at: value.at, payload: JSON.parse(value.payload_json) });
}
export class SqliteEventPort implements LocalEventPort {
  readonly listeners = new Set<(event: Event) => void>();
  constructor(readonly db: Database, readonly clock: Clock) {}
  async record<T extends EventTopic>(tx: Transaction, input: PendingEvent<T>): Promise<Event> {
    const payload = EventPayloadSchemas[input.topic].parse(input.payload);
    const id = IdSchema.parse(crypto.randomUUID());
    const at = this.clock.now();
    const rows = await tx.query(
      "INSERT INTO events(id,topic,aggregate_id,at,payload_json) VALUES(?,?,?,?,?) RETURNING seq",
      [id, input.topic, input.aggregateId, at, JSON.stringify(payload)],
      z.strictObject({ seq: z.number().int().positive() }),
    );
    const [row] = z.tuple([z.strictObject({ seq: z.number().int().positive() })]).parse(rows);
    await tx.execute("INSERT INTO outbox(event_seq) VALUES(?)", [row.seq]);
    return EventSchema.parse({ seq: row.seq, id, topic: input.topic, aggregateId: input.aggregateId, at, payload });
  }
  append<T extends EventTopic>(tx: Database, input: PendingEvent<T>): Event {
    const payload = EventPayloadSchemas[input.topic].parse(input.payload);
    const id = IdSchema.parse(crypto.randomUUID());
    const at = this.clock.now();
    const result = tx.query("INSERT INTO events(id,topic,aggregate_id,at,payload_json) VALUES(?,?,?,?,?)")
      .run(id, input.topic, input.aggregateId, at, JSON.stringify(payload));
    const seq = Number(result.lastInsertRowid);
    tx.query("INSERT INTO outbox(event_seq) VALUES(?)").run(seq);
    return EventSchema.parse({ seq, id, topic: input.topic, aggregateId: input.aggregateId, at, payload });
  }
  after(seq: number, options: { readonly aggregateId?: Id; readonly limit?: number } = {}): readonly Event[] {
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    const rows = options.aggregateId
      ? this.db.query("SELECT * FROM events WHERE seq>? AND aggregate_id=? ORDER BY seq LIMIT ?").all(seq, options.aggregateId, limit)
      : this.db.query("SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?").all(seq, limit);
    return rows.map(fromRow);
  }
  async read(seq: number, options: { readonly aggregateId?: Id; readonly limit?: number } = {}): Promise<readonly Event[]> {
    return this.after(seq, options);
  }
  subscribe(listener: (event: Event) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  dispatch(): void {
    const rows = this.db.query("SELECT e.* FROM events e JOIN outbox o ON o.event_seq=e.seq WHERE o.published_at IS NULL ORDER BY e.seq").all();
    for (const row of rows) {
      const event = fromRow(row);
      for (const listener of this.listeners) listener(event);
      this.db.query("UPDATE outbox SET published_at=?,attempts=attempts+1 WHERE event_seq=?")
        .run(this.clock.now(), event.seq);
    }
  }
}
