import ky from "ky";
import { EventSchema, RealtimeServerMessageSchema, endpoints } from "@quire/contracts";
import type { RealtimeClientMessage } from "@quire/contracts";
import { EditorApiError, editorValue } from "../shared";
import type { EditorClient, EditorWorkspace } from "../shared";
import type { PersistentDocument } from "./document";
import { PresenceBridge } from "./presence";

export type SocketFactory = (url: URL, protocols: readonly string[]) => WebSocket;
export type TransportOptions = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly openSocket?: SocketFactory;
};
/** Owns exactly one socket and invalidation stream; document queue outlives both. */
export class DocumentConnection {
  private socket: WebSocket | null = null;
  private abort = new AbortController();
  private retry: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private generation = 0;
  private presenceEnabled = false;
  private presenceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPresence = -Infinity;
  private eventCursor = 0;
  private readonly presence;
  private readonly tasks = new Set<Promise<void>>();
  constructor(private readonly options: TransportOptions, readonly document: PersistentDocument) {
    this.presence = new PresenceBridge(document, options.workspace.access.actorId);
    document.awareness.on("update", this.localPresence);
  }
  start(): void {
    const signal = this.abort.signal;
    const startup = this.connect().catch(error => {
      if (!(error instanceof Error)) throw error;
      if (signal.aborted) return;
      if (error instanceof EditorApiError) this.document.recover(error.code, error.message, null);
      else if (!this.disposed) { this.document.disconnect(); this.schedule(); }
    });
    this.track(startup);
  }
  private track(task: Promise<void>): void {
    this.tasks.add(task);
    void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
  }
  private schedule(): void {
    clearTimeout(this.retry);
    if (!this.disposed && this.document.getSnapshot().persistence.kind !== "recovery") {
      this.retry = setTimeout(() => this.reconnect(), 1000);
    }
  }
  private readonly localPresence = (change?: { readonly added: readonly number[]; readonly updated: readonly number[] }): void => {
    if (change && ![...change.added, ...change.updated].includes(this.document.awareness.clientID)) return;
    clearTimeout(this.presenceTimer);
    const remaining = 55 - (performance.now() - this.lastPresence);
    if (remaining > 0) this.presenceTimer = setTimeout(() => this.publishPresence(), remaining);
    else this.publishPresence();
  };
  private publishPresence(): void {
    const state = this.document.awareness.getLocalState();
    if (!this.presenceEnabled || this.socket?.readyState !== WebSocket.OPEN || !state) return;
    this.lastPresence = performance.now();
    this.send({ type: "presence", fileId: this.document.file.id,
      cursor: JSON.stringify(state["cursor"] ?? null), name: "" });
  }
  private send(message: RealtimeClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
  private async connect(): Promise<void> {
    const generation = ++this.generation;
    const { client, workspace } = this.options;
    const access = editorValue(await client.call(endpoints.projectAccess, {
      params: { p: workspace.scope.projectId }, query: { branch: workspace.scope.branch },
      headers: workspace.requestHeaders, body: undefined,
    }, this.abort.signal));
    this.document.updateWorkspace({ ...workspace, access });
    this.presenceEnabled = access.actorId !== null;
    const protocols = ["quire"];
    if (access.actorId) {
      const session = editorValue(await client.call(endpoints.me, { params: {}, query: {}, body: undefined }, this.abort.signal));
      protocols.push(`quire.csrf.${session.csrfToken}`);
    }
    if (this.disposed || generation !== this.generation) return;
    const url = client.url(endpoints.realtime, { params: { p: workspace.scope.projectId },
      query: { branch: workspace.scope.branch }, body: undefined });
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const token = workspace.requestHeaders["x-project-token"];
    if (token) url.searchParams.set("share", token);
    const socket = (this.options.openSocket ?? ((target, offered) => new WebSocket(target, [...offered])))(url, protocols);
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (socket !== this.socket || this.disposed) { socket.close(); return; }
      this.document.connect(message => this.send(message));
      this.localPresence();
      const signal = this.abort.signal;
      this.track(this.events(signal).catch(error => {
        if (!(error instanceof Error)) throw error;
        if (!signal.aborted) socket.close(1011, "Invalidation stream interrupted");
      }));
    });
    socket.addEventListener("message", event => {
      if (socket !== this.socket || this.disposed) return;
      try {
        const message = RealtimeServerMessageSchema.parse(JSON.parse(String(event.data)));
        this.document.receive(message);
        if (message.type === "presence") this.presence.receive(message);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        this.document.recover("INVALID_SERVER_MESSAGE", error.message, null);
        socket.close(1002, "Invalid server message");
      }
    });
    socket.addEventListener("close", event => {
      if (socket !== this.socket || this.disposed) return;
      this.socket = null;
      this.abort.abort(); this.abort = new AbortController();
      this.presence.clear();
      if (event.code === 1008) this.document.recover("ACCESS_REVOKED", event.reason || "Session or project access revoked", null);
      else { this.document.disconnect(); this.schedule(); }
    });
  }
  private async events(signal: AbortSignal): Promise<void> {
    const { client, workspace } = this.options;
    const url = client.url(endpoints.events, { params: {}, query: { after: this.eventCursor }, body: undefined });
    const response = await ky(url, { headers: workspace.requestHeaders, credentials: "same-origin",
      retry: 0, timeout: false, signal });
    if (!response.body) throw new TypeError("Missing event stream");
    const reader = response.body.getReader();
    let buffered = "";
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) { if (!signal.aborted) this.socket?.close(1011, "Invalidation stream closed"); return; }
        buffered += decoder.decode(chunk.value, { stream: true });
        let boundary: number;
        while ((boundary = buffered.indexOf("\n\n")) >= 0) {
          const frame = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          const data = frame.split("\n").find(line => line.startsWith("data: "))?.slice(6);
          if (!data) continue;
          const event = EventSchema.parse(JSON.parse(data));
          this.eventCursor = event.seq;
          if (event.topic === "policy.changed"
            || (event.topic === "access.changed" && event.aggregateId === workspace.scope.projectId)) {
            const access = editorValue(await client.call(endpoints.projectAccess, {
              params: { p: workspace.scope.projectId }, query: { branch: workspace.scope.branch },
              headers: workspace.requestHeaders, body: undefined,
            }, signal));
            this.document.updateWorkspace({ ...workspace, access });
          }
        }
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
  }
  reconnect(): void {
    if (this.disposed) return;
    clearTimeout(this.retry);
    this.generation++;
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.abort.abort(); this.abort = new AbortController();
    this.document.disconnect(); this.presence.clear();
    this.start();
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.retry);
    clearTimeout(this.presenceTimer);
    this.generation++;
    const socket = this.socket;
    this.socket = null;
    this.abort.abort();
    const closed = socket && socket.readyState !== WebSocket.CLOSED
      ? new Promise<void>(resolve => socket.addEventListener("close", () => resolve(), { once: true })) : Promise.resolve();
    socket?.close();
    await closed;
    await Promise.all(this.tasks);
    this.document.awareness.off("update", this.localPresence);
    this.presence.clear();
    this.document.close();
  }
}
