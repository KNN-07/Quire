import { createConnection, createServer } from "node:net";
import type { Socket } from "node:net";
import { chmod, lstat, unlink } from "node:fs/promises";
import { z } from "zod";
import { IdSchema, InstantSchema } from "@quire/contracts";
import type { Operation } from "@quire/contracts";
import { BindingSchema, ControlError, ExecutionIdentitySchema } from "./model";
import type { UpdateClient } from "./model";
import { AuthenticatedControlCommand, canonicalJson, ControlEnvelopeSchema } from "./protocol";
import type { ControlCredential, ControlEnvelope } from "./protocol";
import { processIdentity, socketPeer } from "./systemd-process";
import type { ProcessIdentity } from "./systemd-process";
import type { SystemdInstallationAuthority } from "./systemd-authority";
import { ExecutionTaskSchema } from "./execution-model";
import { reportPreparedFailure } from "./prepared-failure";

const frameSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("request"), id: IdSchema, method: z.string().max(32), input: z.json() }),
  z.strictObject({ type: z.literal("response"), id: IdSchema, result: z.json(), error: z.string().max(128).nullable() }),
  z.strictObject({ type: z.literal("event"), topic: z.string().max(32), input: z.json() }),
]);
type Handler = (method: string, input: unknown) => Promise<unknown>;
/** One bounded, canonical frame stream; no unbounded queue or concurrent handler. */
export class ControlChannel {
  private buffer = Buffer.alloc(0);
  private handling = false;
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>;
  }>();
  private handler: Handler = () => Promise.reject(new ControlError("CONTROL_METHOD_DENIED"));
  private eventHandler: (topic: string, input: unknown) => void = () => { throw new ControlError("CONTROL_EVENT_UNEXPECTED"); };
  readonly closed: Promise<void>;
  constructor(readonly socket: Socket, readonly limit = 262144, readonly timeoutMs = 30000) {
    this.closed = new Promise(resolve => socket.once("close", resolve));
    socket.on("error", () => this.close());
    socket.on("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new ControlError("CONTROL_DISCONNECTED"));
      }
      this.pending.clear();
    });
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > this.limit) return this.close();
      try {
        for (;;) {
        const index = this.buffer.indexOf(10);
        if (index < 0) break;
        const bytes = this.buffer.subarray(0, index).toString("utf8");
        this.buffer = this.buffer.subarray(index + 1);
        const input: unknown = JSON.parse(bytes);
        const frame = frameSchema.parse(input);
        if (canonicalJson(frame) !== bytes) throw new ControlError("CONTROL_NONCANONICAL_BYTES");
        if (frame.type === "event") {
          this.eventHandler(frame.topic, frame.input);
        } else if (frame.type === "response") {
          const pending = this.pending.get(frame.id);
          if (!pending) throw new ControlError("CONTROL_RESPONSE_UNEXPECTED");
          this.pending.delete(frame.id);
          clearTimeout(pending.timer);
          if (frame.error) pending.reject(new ControlError(frame.error));
          else pending.resolve(frame.result);
        } else {
          if (this.handling) throw new ControlError("CONTROL_REQUEST_BUSY");
          this.handling = true;
          void this.handler(frame.method, frame.input).then(
            result => this.send({ type: "response", id: frame.id, result: result ?? null, error: null }),
            error => this.send({ type: "response", id: frame.id, result: null,
              error: error instanceof ControlError ? error.code : "CONTROL_REQUEST_FAILED" }),
          ).catch(() => this.close()).finally(() => { this.handling = false; });
        }
        }
      } catch { this.close(); }
    });
  }
  handle(handler: Handler): void { this.handler = handler; }
  handleEvents(handler: (topic: string, input: unknown) => void): void { this.eventHandler = handler; }
  notify(topic: string, input: unknown): void { this.send({ type: "event", topic, input }); }
  private send(value: unknown): void {
    const bytes = canonicalJson(value) + "\n";
    if (Buffer.byteLength(bytes) > this.limit || this.socket.destroyed ||
        this.socket.writableLength > this.limit) throw new ControlError("CONTROL_TRANSPORT_LIMIT");
    this.socket.write(bytes);
  }
  request(method: string, input: unknown): Promise<unknown> {
    if (this.pending.size !== 0) return Promise.reject(new ControlError("CONTROL_REQUEST_BUSY"));
    const id = IdSchema.parse(crypto.randomUUID());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ControlError("CONTROL_REQUEST_TIMEOUT"));
        this.close();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ type: "request", id, method, input }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  close(): void { this.socket.destroy(); }
}
export async function listenControl(path: string, accept: (channel: ControlChannel, peer: ProcessIdentity) => void,
  limit = 262144, timeoutMs = 30000) {
  const channels = new Set<ControlChannel>();
  const server = createServer(socket => {
    const channel = new ControlChannel(socket, limit, timeoutMs);
    channels.add(channel);
    void channel.closed.then(() => channels.delete(channel));
    try {
      const peer = socketPeer(socket);
      if (peer.uid !== process.getuid?.()) throw new ControlError("CONTROL_PEER_DENIED");
      // Install the handler before any request bytes can be processed.
      const identity = processIdentity(peer);
      void identity.catch(() => channel.close());
      channel.handle(async (method, input) => {
        accept(channel, await identity);
        return channelDispatch(channel, method, input);
      });
    } catch { channel.close(); }
  });
  server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
  await chmod(path, 0o600);
  const inode = (await lstat(path)).ino;
  return {
    async close() {
      for (const channel of channels) channel.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      try { if ((await lstat(path)).ino === inode) await unlink(path); }
      catch (error) { if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success) throw error; }
    },
  };
}
// The first asynchronous peer inspection must not race the caller's first frame.
const dispatchers = new WeakMap<ControlChannel, Handler>();
export function handleControl(channel: ControlChannel, handler: Handler): void {
  dispatchers.set(channel, handler);
  channel.handle(handler);
}
function channelDispatch(channel: ControlChannel, method: string, input: unknown): Promise<unknown> {
  const handler = dispatchers.get(channel);
  if (!handler) throw new ControlError("CONTROL_METHOD_DENIED");
  return handler(method, input);
}
export async function connectControl(path: string, limit = 262144, timeoutMs = 30000): Promise<ControlChannel> {
  const socket = createConnection(path);
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  if (socketPeer(socket).uid !== process.getuid?.()) { socket.destroy(); throw new ControlError("CONTROL_PEER_DENIED"); }
  return new ControlChannel(socket, limit, timeoutMs);
}
export function createUnixUpdateTransport(socketPath: string) {
  return {
    async send(envelope: ControlEnvelope): Promise<unknown> {
      const channel = await connectControl(socketPath);
      try { return await channel.request("control", envelope); }
      finally { channel.close(); }
    },
  };
}
export interface ControllerServerOptions {
  readonly path: string;
  readonly authority: SystemdInstallationAuthority;
  readonly credentials: readonly { readonly credential: ControlCredential; readonly role: string | null }[];
  readonly service: UpdateClient & { recover(command: AuthenticatedControlCommand): Promise<Operation> };
}
export async function startControllerServer(options: ControllerServerOptions) {
  await options.authority.prepareControlSocket(options.path);
  return listenControl(options.path, (channel, peer) => {
    handleControl(channel, async (method, input) => {
      if (method !== "control") throw new ControlError("CONTROL_METHOD_DENIED");
      const envelope = ControlEnvelopeSchema.parse(input);
      const allowed = options.credentials.find(item => item.credential.id === envelope.credentialId);
      if (!allowed) throw new ControlError("CONTROL_UNAUTHENTICATED");
      const authenticated = AuthenticatedControlCommand.authenticate(envelope, allowed.credential,
        InstantSchema.parse(new Date().toISOString()));
      await options.authority.authenticateCaller(peer, allowed.credential.channel, allowed.role);
      switch (envelope.command.method) {
        case "submit": return options.service.create(envelope.command.input);
        case "get": return options.service.get(envelope.command.input.id);
        case "list": return options.service.list(envelope.command.input);
        case "releases": return options.service.releases();
        case "status": return options.authority.status();
        case "recover": return options.service.recover(authenticated);
      }
      throw new ControlError("CONTROL_METHOD_DENIED");
    });
  }, options.authority.config.requestBytes, options.authority.config.requestTimeoutMs);
}

export const LaunchPermitSchema = z.strictObject({
  execution: ExecutionIdentitySchema,
  binding: BindingSchema,
  token: z.string().regex(/^[0-9a-f]{64}$/),
  task: ExecutionTaskSchema.optional(),
});
export type ControlledRoleSession = {
  readonly permit: z.infer<typeof LaunchPermitSchema>;
  readonly channel: ControlChannel;
  readonly socketPath?: string;
};
export async function connectControlledRole(socketPath: string): Promise<ControlledRoleSession> {
  const channel = await connectControl(socketPath);
  try {
    const permit = LaunchPermitSchema.parse(await channel.request("launch", {}));
    return { permit, channel, socketPath };
  } catch (error) { channel.close(); throw error; }
}
export interface ControlledLifecycle {
  check(): Promise<unknown>;
  activate(): Promise<unknown>;
  dispose(): Promise<void>;
}
/** The trusted launcher installs its real prepared lifecycle before advertising readiness. */
export async function servePreparedRole(session: ControlledRoleSession, lifecycle: ControlledLifecycle): Promise<void> {
  const { channel, permit } = session;
  const stop = () => channel.close();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  let active = false;
  handleControl(channel, async (method, value) => {
    const input = z.strictObject({ token: z.string(), generation: z.number().int(), epoch: IdSchema }).parse(value);
    if (input.token !== permit.token || input.generation !== permit.execution.generation ||
        input.epoch !== permit.execution.supervisorEpoch) throw new ControlError("CONTROL_ACTIVATION_DENIED");
    if (method === "check") {
      try { return await lifecycle.check(); }
      catch (error) {
        if (active || permit.execution.purpose !== "prepared") throw error;
        return reportPreparedFailure(session, "check", error);
      }
    }
    if (method === "activate") { await lifecycle.activate(); active = true; return { active: true }; }
    throw new ControlError("CONTROL_METHOD_DENIED");
  });
  try {
    await channel.request("ready", { token: permit.token });
    await channel.closed;
  } finally {
    channel.close();
    await lifecycle.dispose();
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}
