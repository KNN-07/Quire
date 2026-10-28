import { ScopeSchema, type Scope } from "@quire/contracts";
import { RedisWire } from "./wire";

export type RedisTransportState = "disconnected" | "connecting" | "ready" | "closed";
export type RedisTransportOptions = {
  readonly url: string;
  readonly namespace: string;
  readonly connectionTimeoutMs?: number;
};

/**
 * Advisory wake transport only. A ready transition requires durable catch-up.
 * Call connect again after a disconnect; it resolves only after SUBSCRIBE ACKs.
 * SQL event rows, lease ownership and fences never live here.
 */
export class RedisNotificationTransport {
  private stateValue: RedisTransportState = "disconnected";
  private publisher: RedisWire | undefined;
  private subscriber: RedisWire | undefined;
  private readonly disposing = new Set<Promise<void>>();
  private connecting: Promise<void> | undefined;
  private readonly events = new Set<() => void>();
  private readonly leases = new Set<(scope: Scope) => void>();
  private readonly states = new Set<(state: RedisTransportState) => void>();
  private readonly eventsChannel: string;
  private readonly leasesChannel: string;

  constructor(private readonly options: RedisTransportOptions) {
    if (!options.namespace.trim()) throw new Error("REDIS_NAMESPACE_REQUIRED");
    this.eventsChannel = `${options.namespace}:events`;
    this.leasesChannel = `${options.namespace}:leases`;
  }

  get state(): RedisTransportState { return this.stateValue; }

  subscribeEvents(listener: () => void): () => void {
    this.assertOpen();
    this.events.add(listener);
    return () => { this.events.delete(listener); };
  }

  subscribeLeases(listener: (scope: Scope) => void): () => void {
    this.assertOpen();
    this.leases.add(listener);
    return () => { this.leases.delete(listener); };
  }

  subscribeState(listener: (state: RedisTransportState) => void): () => void {
    this.assertOpen();
    this.states.add(listener);
    return () => { this.states.delete(listener); };
  }

  connect(): Promise<void> {
    this.assertOpen();
    if (this.stateValue === "ready") return Promise.resolve();
    if (this.connecting) return this.connecting;
    const pending = this.open();
    this.connecting = pending;
    void pending.finally(() => {
      if (this.connecting === pending) this.connecting = undefined;
    }).catch(() => { /* The caller receives the original connection failure. */ });
    return pending;
  }

  async publishEvents(): Promise<void> {
    await this.readyPublisher().command(["PUBLISH", this.eventsChannel, "wake"]);
  }

  async publishLease(scope: Scope): Promise<void> {
    const parsed = ScopeSchema.parse(scope);
    await this.readyPublisher().command(["PUBLISH", this.leasesChannel, JSON.stringify(parsed)]);
  }

  async close(): Promise<void> {
    if (this.stateValue === "closed") return;
    this.setState("closed");
    this.disposeConnections();
    await this.connecting?.catch(() => { /* Closing cancels connection admission. */ });
    await Promise.all(this.disposing);
    this.events.clear();
    this.leases.clear();
    this.states.clear();
  }

  private async open(): Promise<void> {
    this.disposeConnections();
    const url = new URL(this.options.url);
    const timeoutMs = this.options.connectionTimeoutMs ?? 5_000;
    const publisher = new RedisWire(url, timeoutMs);
    const subscriber = new RedisWire(url, timeoutMs);
    this.publisher = publisher;
    this.subscriber = subscriber;
    const disconnected = () => {
      if (this.publisher !== publisher || this.stateValue === "closed") return;
      this.disposeConnections();
      this.setState("disconnected");
    };
    publisher.onclose = disconnected;
    subscriber.onclose = disconnected;
    this.setState("connecting");
    try {
      const connections = await Promise.allSettled([publisher.connect(), subscriber.connect()]);
      for (const connection of connections) {
        if (connection.status === "rejected") throw connection.reason;
      }
      subscriber.onmessage = (channel, message) => {
        if (this.stateValue !== "ready") return;
        if (channel === this.eventsChannel) {
          if (message === "wake") for (const listener of this.events) listener();
          return;
        }
        if (channel !== this.leasesChannel) return;
        let value: unknown;
        try { value = JSON.parse(message); } catch { return; }
        const result = ScopeSchema.safeParse(value);
        if (result.success) for (const listener of this.leases) listener(result.data);
      };
      await subscriber.command(["SUBSCRIBE", this.eventsChannel]);
      await subscriber.command(["SUBSCRIBE", this.leasesChannel]);
      if (this.publisher !== publisher || this.stateValue === "closed") {
        throw new Error("REDIS_CONNECTION_CANCELLED");
      }
      this.setState("ready");
    } catch (error) {
      if (this.publisher === publisher && this.stateValue !== "closed") {
        this.disposeConnections();
        this.setState("disconnected");
      }
      throw error;
    }
  }

  private disposeConnections(): void {
    const clients = [this.publisher, this.subscriber];
    this.publisher = undefined;
    this.subscriber = undefined;
    for (const client of clients) {
      if (!client) continue;
      client.onclose = null;
      client.onmessage = null;
      this.disposing.add(client.closed);
      void client.closed.then(() => { this.disposing.delete(client.closed); });
      client.close();
    }
  }

  private setState(state: RedisTransportState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    for (const listener of this.states) listener(state);
  }

  private assertOpen(): void {
    if (this.stateValue === "closed") throw new Error("REDIS_TRANSPORT_CLOSED");
  }

  private readyPublisher(): RedisWire {
    this.assertOpen();
    if (this.stateValue !== "ready" || !this.publisher) throw new Error("REDIS_TRANSPORT_NOT_READY");
    return this.publisher;
  }
}
