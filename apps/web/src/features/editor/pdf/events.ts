import ky from "ky";
import { EventSchema, endpoints } from "@quire/contracts";
import type { Event } from "@quire/contracts";
import type { EditorClient, EditorWorkspace } from "../shared";

type EventWorkspace = Pick<EditorWorkspace, "scope" | "requestHeaders">;

/** One abortable header-capable SSE connection; durable cursor covers startup races. */
export class PdfEvents {
  private readonly abort = new AbortController();
  private readonly listeners = new Set<(event: Event) => void>();
  private readonly ready = Promise.withResolvers<void>();
  private readonly task: Promise<void>;
  constructor(
    client: EditorClient,
    workspace: EventWorkspace,
    onError: (error: Error) => void,
  ) {
    this.task = this.read(client, workspace).catch(error => {
      if (!(error instanceof Error)) throw error;
      if (!this.abort.signal.aborted) { this.ready.reject(error); onError(error); }
    });
  }
  subscribe(listener: (event: Event) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  connected(): Promise<void> { return this.ready.promise; }
  private async read(client: EditorClient, workspace: EventWorkspace): Promise<void> {
    const response = await ky.get(client.url(endpoints.events, {
      params: {}, query: { after: 0 }, body: undefined,
    }), { headers: workspace.requestHeaders, signal: this.abort.signal,
      timeout: false, retry: 0, credentials: "same-origin" });
    if (!response.body) throw new TypeError("Compilation event stream has no response body");
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    this.ready.resolve();
    let buffer = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) throw new TypeError("Compilation event stream disconnected");
        buffer += chunk.value.replaceAll("\r\n", "\n");
        let end = buffer.indexOf("\n\n");
        while (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame.split("\n").filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).trimStart()).join("\n");
          if (data) {
            const event = EventSchema.parse(JSON.parse(data));
            if (event.aggregateId === workspace.scope.projectId) {
              for (const listener of this.listeners) listener(event);
            }
          }
          end = buffer.indexOf("\n\n");
        }
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
  }
  async dispose(): Promise<void> {
    this.abort.abort();
    this.ready.reject(this.abort.signal.reason);
    this.listeners.clear();
    await this.task;
  }
}
