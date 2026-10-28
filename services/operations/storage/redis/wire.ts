import { createConnection } from "node:net";
import { connect as connectTls } from "node:tls";

type Reply = string | number | null | Error | readonly Reply[];
type Parsed = { readonly value: Reply; readonly end: number };

/** RESP2 only: commands/replies and Pub/Sub frames, not Redis storage authority. */
function parse(buffer: Buffer, offset = 0): Parsed | undefined {
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) return undefined;
  const type = buffer.toString("utf8", offset, offset + 1);
  const text = buffer.toString("utf8", offset + 1, end);
  const next = end + 2;
  if (type === "+") return { value: text, end: next };
  if (type === "-") return { value: new Error(text), end: next };
  const count = Number(text);
  if (!Number.isSafeInteger(count)) throw new Error("REDIS_INVALID_REPLY");
  if (type === ":") return { value: count, end: next };
  if (count === -1 && (type === "$" || type === "*")) return { value: null, end: next };
  if (count < 0) throw new Error("REDIS_INVALID_REPLY");
  if (type === "$") {
    if (buffer.length < next + count + 2) return undefined;
    if (buffer.toString("utf8", next + count, next + count + 2) !== "\r\n") {
      throw new Error("REDIS_INVALID_REPLY");
    }
    return { value: buffer.toString("utf8", next, next + count), end: next + count + 2 };
  }
  if (type === "*") {
    const values: Reply[] = [];
    let cursor = next;
    for (let i = 0; i < count; i++) {
      const item = parse(buffer, cursor);
      if (!item) return undefined;
      values.push(item.value);
      cursor = item.end;
    }
    return { value: values, end: cursor };
  }
  throw new Error("REDIS_INVALID_REPLY");
}

type Pending = {
  readonly resolve: (reply: Reply) => void;
  readonly reject: (error: Error) => void;
};

/** Owned minimal client avoids the reproduced native 1.3.14 RedisClient panic. */
export class RedisWire {
  onclose: (() => void) | null = null;
  onmessage: ((channel: string, message: string) => void) | null = null;
  private socket?: ReturnType<typeof createConnection>;
  private buffer = Buffer.alloc(0);
  private readonly pending: Pending[] = [];
  private readonly ended = Promise.withResolvers<void>();
  readonly closed = this.ended.promise;
  private error: Error | undefined;

  constructor(private readonly url: URL, private readonly timeoutMs: number) {
    if (url.protocol !== "redis:" && url.protocol !== "rediss:") throw new Error("REDIS_URL_PROTOCOL");
  }

  async connect(): Promise<void> {
    const ready = Promise.withResolvers<void>();
    const options = { host: this.url.hostname.replace(/^\[|\]$/g, ""), port: Number(this.url.port || 6379) };
    const secure = this.url.protocol === "rediss:";
    const socket = secure
      ? connectTls({ ...options, servername: options.host })
      : createConnection(options);
    this.socket = socket;
    const timer = setTimeout(() => { socket.destroy(new Error("REDIS_CONNECT_TIMEOUT")); }, this.timeoutMs);
    socket.once(secure ? "secureConnect" : "connect", () => { ready.resolve(); });
    socket.on("error", (error: Error) => {
      this.error = error;
      ready.reject(error);
    });
    socket.on("data", (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      try {
        while (true) {
          const reply = parse(this.buffer);
          if (!reply) break;
          this.buffer = this.buffer.subarray(reply.end);
          const value = reply.value;
          if (Array.isArray(value) && value[0] === "message") {
            const channel: unknown = value[1];
            const message: unknown = value[2];
            if (typeof channel === "string" && typeof message === "string") this.onmessage?.(channel, message);
          } else {
            const request = this.pending.shift();
            if (!request) throw new Error("REDIS_UNEXPECTED_REPLY");
            if (value instanceof Error) request.reject(value);
            else request.resolve(value);
          }
        }
      } catch (error) {
        socket.destroy(error instanceof Error ? error : new Error("REDIS_INVALID_REPLY"));
      }
    });
    socket.once("close", () => {
      clearTimeout(timer);
      const error = this.error ?? new Error("REDIS_DISCONNECTED");
      ready.reject(error);
      for (const request of this.pending.splice(0)) request.reject(error);
      this.ended.resolve();
      this.onclose?.();
    });
    try {
      await ready.promise;
      if (this.url.password) {
        const password = decodeURIComponent(this.url.password);
        await this.command(this.url.username
          ? ["AUTH", decodeURIComponent(this.url.username), password] : ["AUTH", password]);
      }
      if (this.url.pathname && this.url.pathname !== "/") {
        await this.command(["SELECT", this.url.pathname.slice(1)]);
      }
      await this.command(["PING"]);
    } finally { clearTimeout(timer); }
  }

  command(parts: readonly string[]): Promise<Reply> {
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new Error("REDIS_DISCONNECTED"));
    const request = Promise.withResolvers<Reply>();
    const timer = setTimeout(() => { socket.destroy(new Error("REDIS_COMMAND_TIMEOUT")); }, this.timeoutMs);
    this.pending.push(request);
    const encoded = parts.map(part => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("");
    socket.write(`*${parts.length}\r\n${encoded}`);
    return request.promise.finally(() => { clearTimeout(timer); });
  }

  close(): void {
    if (this.socket) this.socket.destroy();
    else this.ended.resolve();
  }
}
