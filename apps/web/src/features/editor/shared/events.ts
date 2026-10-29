import ky from "ky";
import { EventSchema, endpoints } from "@quire/contracts";
import type { Event, Id } from "@quire/contracts";
import type { EditorClient, EditorRequestHeaders } from "./contracts";
import { EditorApiError, editorValue } from "./api";

type EventInput = {
  readonly client: EditorClient;
  readonly headers: EditorRequestHeaders;
  readonly signal: AbortSignal;
  readonly actorId?: Id | null;
  readonly after?: number;
  readonly onOpen?: () => void;
  readonly receive: (event: Event) => void | Promise<void>;
};
type Listener = {
  cursor: number;
  replayThrough: number;
  readonly enqueue: (action: () => void | Promise<void>) => void;
  readonly open: () => void;
  readonly receive: (event: Event) => void | Promise<void>;
  readonly fail: (error: unknown) => void;
};

type Authority = { readonly actorId: Id | null; readonly csrfToken: string | null };
// /api/me's CSRF token is derived from the actual session cookie. Actor equality
// alone cannot authorize sharing private AI events between that actor's sessions.
const streams = new WeakMap<EditorClient, Map<object | string, SharedEvents>>();

async function eventAuthority(client: EditorClient, signal: AbortSignal): Promise<Authority> {
  const account = await client.call(endpoints.me, { params: {}, query: {}, body: undefined }, signal);
  if ("error" in account && account.error.code === "UNAUTHENTICATED") return { actorId: null, csrfToken: null };
  const session = editorValue(account);
  return { actorId: session.user.id, csrfToken: session.csrfToken };
}
export async function editorEventActor(client: EditorClient, signal: AbortSignal): Promise<Id | null> {
  return (await eventAuthority(client, signal)).actorId;
}

class SharedEvents {
  private readonly listeners = new Set<Listener>();
  private controller: AbortController | null = null;
  private cursor = 0;
  private opened = false;
  private rewind = false;
  private readonly task: Promise<void>;
  constructor(private readonly input: Pick<EventInput, "client" | "headers">,
    private readonly authority: Authority | null, private readonly forget: () => void) {
    // Attach all synchronous subscribers before opening the connection.
    this.task = Promise.resolve().then(() => this.read()).catch(error => {
      this.forget();
      for (const listener of [...this.listeners]) listener.fail(error);
    });
  }
  subscribe(input: EventInput): Promise<void> {
    const completion = Promise.withResolvers<void>();
    let active = true;
    let tail = Promise.resolve();
    const finish = (failure?: { readonly error: unknown }) => {
      if (!active) return;
      active = false;
      input.signal.removeEventListener("abort", aborted);
      this.listeners.delete(listener);
      const last = this.listeners.size === 0;
      if (last) { this.forget(); this.controller?.abort(); }
      // A subscriber owns its in-flight callback, not another consumer's queue.
      void tail.then(async () => {
        if (last) await this.task;
        if (failure) completion.reject(failure.error);
        else completion.resolve();
      });
    };
    const aborted = () => finish();
    const listener: Listener = {
      cursor: input.after ?? 0,
      replayThrough: input.after ?? 0,
      enqueue(action) {
        tail = tail.then(async () => { if (active) await action(); })
          .catch(error => finish({ error }));
      },
      open: () => input.onOpen?.(),
      receive: input.receive,
      fail: error => listener.enqueue(() => { throw error; }),
    };
    this.listeners.add(listener);
    input.signal.addEventListener("abort", aborted, { once: true });
    if (input.signal.aborted) aborted();
    else if (listener.cursor < this.cursor) {
      // No private history cache: late consumers rewind the one connection.
      // Existing listeners suppress replay through their own queued cursor.
      this.rewind = true;
      this.controller?.abort();
    } else if (this.opened && !this.rewind) listener.enqueue(listener.open);
    return completion.promise;
  }
  private async read(): Promise<void> {
    while (this.listeners.size) {
      this.rewind = false;
      this.opened = false;
      this.cursor = Math.min(...[...this.listeners].map(listener => listener.cursor));
      for (const listener of this.listeners) listener.replayThrough = listener.cursor;
      const controller = new AbortController();
      this.controller = controller;
      try {
        if (this.authority) {
          const current = await eventAuthority(this.input.client, controller.signal);
          if (current.actorId !== this.authority.actorId || current.csrfToken !== this.authority.csrfToken) {
            throw new EditorApiError("EVENT_AUTHORITY_CHANGED", "Reopen the editor after changing sessions");
          }
        }
        const response = await ky(this.input.client.url(endpoints.events, {
          params: {}, query: { after: this.cursor }, body: undefined,
        }), { headers: this.input.headers, credentials: "same-origin",
          retry: 0, timeout: false, signal: controller.signal });
        if (!response.body) throw new TypeError("Missing editor event stream");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        try {
          if (controller.signal.aborted) continue;
          this.opened = true;
          for (const listener of this.listeners) listener.enqueue(listener.open);
          for (;;) {
            const chunk = await reader.read();
            if (controller.signal.aborted) break;
            if (chunk.done) throw new TypeError("Editor event stream disconnected");
            buffered += decoder.decode(chunk.value, { stream: true });
            // Normalize after buffering so a CRLF split across chunks is intact.
            buffered = buffered.replaceAll("\r\n", "\n");
            let boundary: number;
            while ((boundary = buffered.indexOf("\n\n")) >= 0) {
              const frame = buffered.slice(0, boundary);
              buffered = buffered.slice(boundary + 2);
              const data = frame.split("\n").filter(line => line.startsWith("data:"))
                .map(line => line.slice(5).trimStart()).join("\n");
              if (!data) continue;
              const event = EventSchema.parse(JSON.parse(data));
              this.cursor = Math.max(this.cursor, event.seq);
              for (const listener of this.listeners) {
                if (event.seq <= listener.replayThrough) continue;
                listener.cursor = Math.max(listener.cursor, event.seq);
                listener.enqueue(() => listener.receive(event));
              }
            }
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally { this.opened = false; }
      if (!this.rewind) return;
    }
  }
}

/** Every shared subscriber resolves the current server-authenticated session. */
export async function editorEvents(input: EventInput): Promise<void> {
  if (input.signal.aborted) return;
  const authority = input.actorId === undefined ? null : await eventAuthority(input.client, input.signal);
  if (input.signal.aborted) return;
  if (authority && authority.actorId !== input.actorId) {
    throw new EditorApiError("EVENT_AUTHORITY_CHANGED", "Reopen the editor after changing sessions");
  }
  // The standalone PDF API can omit access metadata; without a trusted session
  // boundary it gets a dedicated reader, never a reusable shared scope.
  const key = authority === null ? {}
    : JSON.stringify([authority.actorId, authority.csrfToken, input.headers["x-project-token"] ?? null]);
  let scopes = streams.get(input.client);
  if (!scopes) { scopes = new Map(); streams.set(input.client, scopes); }
  let stream = scopes.get(key);
  if (!stream) {
    const ownedScopes = scopes;
    const created = new SharedEvents({ client: input.client, headers: { ...input.headers } }, authority, () => {
      if (ownedScopes.get(key) === created) ownedScopes.delete(key);
    });
    stream = created;
    scopes.set(key, stream);
  }
  return stream.subscribe(input);
}
