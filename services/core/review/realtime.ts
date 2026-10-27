import * as Y from "yjs";
import { z } from "zod";
import { IdSchema, BranchSchema, RealtimeClientMessageSchema, RealtimeServerMessageSchema, assertNever } from "@quire/contracts";
import type { RealtimeClientMessage, RealtimeServerMessage, Scope, Id } from "@quire/contracts";
import type { RealtimePort, RealtimeSocketData, ModuleContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import type { Server, ServerWebSocket } from "bun";
import { DocumentUpdates } from "./updates";
import { fail, uuid } from "./store";

type Socket = ServerWebSocket<RealtimeSocketData>;
type Connection = { readonly request: Request; readonly files: Map<Id, number>; readonly presence: Map<string, number> };
const upgradePath = /^\/api\/projects\/([^/]+)\/realtime\/?$/;
export class RealtimeService extends DocumentUpdates implements RealtimePort {
  private readonly sockets = new Map<Socket, Connection>();
  private readonly pending = new Map<string, Request>();
  private readonly unsubscribe: () => void;
  constructor(context: ModuleContext) {
    super(context);
    this.unsubscribe = context.events.subscribe(event => {
      switch (event.topic) {
        case "session.revoked": {
          for (const socket of this.sockets.keys()) {
            if (socket.data.actorId === event.payload.userId
              && (event.payload.sessionId === null || socket.data.sessionId === event.payload.sessionId)) socket.close(1008, "Session revoked");
          }
          return;
        }
        case "access.changed":
        case "tree.changed": {
          for (const [socket, connection] of this.sockets) {
            if (socket.data.scope.projectId !== event.aggregateId) continue;
            void this.refresh(socket, connection, event.topic === "tree.changed");
          }
          return;
        }
        case "policy.changed": {
          for (const [socket, connection] of this.sockets) void this.refresh(socket, connection, false);
          return;
        }
        case "document.saved":
        case "review.changed":
        case "history.created":
        case "git.changed":
        case "job.changed":
        case "operation.changed":
        case "notification.created": return;
        default: assertNever(event);
      }
    });
  }
  readonly handlers: RealtimePort["handlers"] = {
    open: socket => {
      const request = this.pending.get(socket.data.connectionId);
      if (!request) { socket.close(1008, "Missing upgrade"); return; }
      this.pending.delete(socket.data.connectionId);
      this.sockets.set(socket, { request, files: new Map(), presence: new Map() });
    },
    message: async (socket, bytes) => {
      try {
        const connection = this.sockets.get(socket);
        if (!connection) return;
        const parsed: unknown = JSON.parse(typeof bytes === "string" ? bytes : Buffer.from(bytes).toString());
        const message = RealtimeClientMessageSchema.parse(parsed);
        await this.receive(socket, connection, message);
      } catch (error) {
        if (error instanceof ServiceError) {
          this.send(socket, { type: "error", code: error.code, message: error.message, recoveryText: null });
          if (error.status === 401 || error.status === 403 || error.status === 404) socket.close(1008, error.code);
        } else if (error instanceof z.ZodError || error instanceof SyntaxError) {
          this.send(socket, { type: "error", code: "INVALID_MESSAGE", message: "Invalid realtime message", recoveryText: null });
        } else { throw error; }
      }
    },
    close: socket => { this.sockets.delete(socket); },
  };
  async upgrade(request: Request, server: Server<RealtimeSocketData>): Promise<Response | undefined> {
    try {
      const url = new URL(request.url);
      const match = upgradePath.exec(url.pathname);
      if (!match) return new Response("Not found", { status: 404 });
      const scope: Scope = { projectId: IdSchema.parse(match[1]), branch: BranchSchema.parse(url.searchParams.get("branch")) };
      const identity = this.context.services.get("identity");
      const headers = new Headers(request.headers);
      const csrfProtocol = headers.get("sec-websocket-protocol")?.split(",").map(value => value.trim())
        .find(value => value.startsWith("quire.csrf."));
      if (csrfProtocol) headers.set("x-csrf-token", csrfProtocol.slice("quire.csrf.".length));
      const authorizedRequest = new Request(request, { headers });
      const principal = await identity.authenticate(authorizedRequest);
      // WebSocket handshake is a stateful transport, even though its HTTP verb is GET.
      if (principal) await identity.verifyMutation(authorizedRequest, principal);
      else if (headers.get("origin") !== new URL(this.context.config.publicUrl).origin
        || headers.get("sec-fetch-site") === "cross-site") fail("ORIGIN_DENIED", 403, "Same-origin request required");
      await this.authorizeRead(authorizedRequest, scope);
      const connectionId = uuid();
      this.pending.set(connectionId, authorizedRequest);
      const accepted = server.upgrade(request, {
        ...(headers.get("sec-websocket-protocol")?.split(",").some(value => value.trim() === "quire")
          ? { headers: { "sec-websocket-protocol": "quire" } } : {}),
        data: { actorId: principal?.user.id ?? null, sessionId: principal?.sessionId ?? null, connectionId, scope },
      });
      if (!accepted) { this.pending.delete(connectionId); return new Response("Upgrade required", { status: 426 }); }
      return undefined;
    } catch (error) {
      if (error instanceof ServiceError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
      if (error instanceof z.ZodError) return new Response("Invalid scope", { status: 400 });
      throw error;
    }
  }
  private send(socket: Socket, message: RealtimeServerMessage): void {
    socket.send(JSON.stringify(RealtimeServerMessageSchema.parse(message)));
  }
  private async receive(socket: Socket, connection: Connection, message: RealtimeClientMessage): Promise<void> {
    const { scope } = socket.data;
    if (socket.data.sessionId) await this.context.services.get("identity").require(connection.request);
    await this.authorizeRead(connection.request, scope);
    const file = this.projects.getFile(scope, message.fileId);
    if (!file.editable) fail("NOT_EDITABLE", 422, "File is not editable");
    switch (message.type) {
      case "sync": {
        if (file.version.epoch !== message.epoch) {
          this.send(socket, { type: "error", code: "EPOCH_CHANGED",
            message: "Recover offline changes against the new document epoch", recoveryText: this.projects.loadDocument(scope, file.id).text });
          return;
        }
        connection.files.set(file.id, message.epoch);
        this.sync(socket, file.id, message.stateVectorBase64);
        return;
      }
      case "update": {
        await this.projects.authorizeRequest(connection.request, scope, "document.update");
        if (file.version.epoch !== message.epoch) {
          this.send(socket, { type: "error", code: "EPOCH_CHANGED", message: "Offline edits require explicit recovery",
            recoveryText: this.projects.loadDocument(scope, file.id).text }); return;
        }
        const ack = await this.update(connection.request, scope, message);
        this.send(socket, ack);
        return;
      }
      case "presence": {
        const now = performance.now();
        if (now - (connection.presence.get(file.id) ?? -Infinity) < 50) return;
        connection.presence.set(file.id, now);
        const principal = await this.context.services.get("identity").require(connection.request);
        for (const [peer, target] of this.sockets) {
          if (peer.data.scope.projectId === scope.projectId && peer.data.scope.branch === scope.branch && target.files.has(file.id)) {
            await this.authorizeRead(target.request, scope);
            this.send(peer, { ...message, name: principal.user.name, userId: principal.user.id });
          }
        }
        return;
      }
      default: assertNever(message);
    }
  }
  private sync(socket: Socket, fileId: Id, vector?: string): void {
    const source = this.projects.loadDocument(socket.data.scope, fileId);
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, Buffer.from(source.state, "base64"));
      let update: Uint8Array;
      try { update = Y.encodeStateAsUpdate(doc, vector ? Buffer.from(vector, "base64") : undefined); }
      catch (error) {
        if (error instanceof Error) fail("INVALID_VECTOR", 400, "Invalid Yjs state vector");
        throw error;
      }
      this.send(socket, { type: "update", fileId, epoch: source.epoch, revision: source.revision,
        updateBase64: Buffer.from(update).toString("base64") });
    } finally { doc.destroy(); }
  }
  private async refresh(socket: Socket, connection: Connection, changed: boolean): Promise<void> {
    try {
      if (socket.data.sessionId) await this.context.services.get("identity").require(connection.request);
      await this.authorizeRead(connection.request, socket.data.scope);
      if (changed) {
        for (const [fileId, epoch] of connection.files) {
          const file = this.projects.listFiles(socket.data.scope).find(entry => entry.id === fileId && entry.editable);
          if (!file) {
            connection.files.delete(fileId);
            this.send(socket, { type: "error", code: "FILE_REMOVED", message: "The subscribed file was removed", recoveryText: null });
          } else if (file.version.epoch !== epoch) {
            connection.files.delete(fileId);
            this.send(socket, { type: "error", code: "EPOCH_CHANGED", message: "Recover local edits before synchronizing",
              recoveryText: this.projects.loadDocument(socket.data.scope, fileId).text });
          } else this.sync(socket, fileId);
        }
      }
    } catch (error) {
      if (error instanceof ServiceError) { socket.close(1008, "Access revoked"); return; }
      throw error;
    }
  }
  dispose(): void {
    this.unsubscribe();
    for (const socket of this.sockets.keys()) socket.close(1001, "Service stopped");
    this.sockets.clear(); this.pending.clear();
  }
}
