import type { Event } from "@quire/contracts";
import type { EditorClient, EditorWorkspace } from "../shared";
import { editorEvents } from "../shared/events";

type EventWorkspace = Pick<EditorWorkspace, "scope" | "requestHeaders"> & {
  readonly access?: Pick<EditorWorkspace["access"], "actorId">;
};

/** One independently abortable subscription; durable replay covers startup races. */
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
    await editorEvents({ client, headers: workspace.requestHeaders, signal: this.abort.signal,
      ...workspace.access ? { actorId: workspace.access.actorId } : {},
      onOpen: () => this.ready.resolve(),
      receive: event => {
        if (event.aggregateId === workspace.scope.projectId) {
          for (const listener of this.listeners) listener(event);
        }
      },
    });
  }
  async dispose(): Promise<void> {
    this.abort.abort();
    this.ready.reject(this.abort.signal.reason);
    this.listeners.clear();
    await this.task;
  }
}
