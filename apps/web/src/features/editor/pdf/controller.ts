import { endpoints } from "@quire/contracts";
import type { CompileRequest, CompileJob, CompileSettings } from "@quire/contracts";
import { EditorApiError, editorValue } from "../shared";
import type { CompileController, CompileState, PdfPanelProps } from "../shared";
import { PdfEvents } from "./events";

type ControllerOptions = Pick<PdfPanelProps, "client" | "workspace" | "document"> & {
  readonly onError: (error: Error) => void;
};

/** Sole ordinary-preview owner. No polling and no browser persistence authority. */
export class PdfCompileController implements CompileController {
  private state: CompileState = { job: null, preview: null };
  private readonly listeners = new Set<() => void>();
  private readonly abort = new AbortController();
  private readonly events: PdfEvents;
  private updates = Promise.resolve();
  private disposed = false;
  private initialized = false;
  private submitting = false;
  private automatic = false;
  private autoRevision: number;
  private autoPendingRevision: number | null = null;
  private settings: CompileSettings;
  private readonly unsubscribeDocument: (() => void) | undefined;
  readonly ready: Promise<void>;
  constructor(private readonly options: ControllerOptions) {
    this.settings = options.workspace.project.settings;
    this.autoRevision = options.workspace.access.branchRevision;
    this.events = new PdfEvents(options.client, options.workspace, options.onError);
    this.events.subscribe(event => {
      if (event.topic === "job.changed" || event.topic === "document.saved" ||
          event.topic === "tree.changed") {
        void this.enqueue(async () => {
          await this.readPreview();
          if (this.automatic && event.topic !== "job.changed") {
            this.documentChanged((await this.access()).branchRevision);
          }
        });
      }
    });
    this.unsubscribeDocument = options.document?.subscribe(() => this.documentChanged());
    this.ready = this.events.connected().then(async () => {
      await this.refresh();
      this.initialized = true;
      if (this.automatic) this.documentChanged((await this.access()).branchRevision);
    });
  }
  readonly getSnapshot = (): CompileState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private report(error: unknown): void {
    if (!(error instanceof Error)) throw error;
    if (!this.abort.signal.aborted) this.options.onError(error);
  }
  private publish(state: CompileState): void {
    if (this.disposed) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private enqueue(update: () => Promise<void>): Promise<void> {
    const next = this.updates.then(update);
    this.updates = next.catch(error => this.report(error));
    return next;
  }
  refresh(): Promise<void> {
    return this.enqueue(() => this.readPreview());
  }
  private async readPreview(): Promise<void> {
    const { client, workspace } = this.options;
    const state = editorValue(await client.call(endpoints.compilePreview, {
      params: { p: workspace.scope.projectId }, query: { branch: workspace.scope.branch },
      body: undefined, headers: workspace.requestHeaders,
    }, this.abort.signal));
    this.autoRevision = Math.max(this.autoRevision, state.job?.snapshot.revision ?? this.autoRevision);
    if (this.autoPendingRevision !== null && this.autoPendingRevision <= this.autoRevision) this.autoPendingRevision = null;
    this.publish(state);
    if (this.autoPendingRevision !== null && !this.busy()) this.documentChanged(this.autoPendingRevision);
  }
  private busy(): boolean {
    return this.submitting || this.state.job?.status === "queued" || this.state.job?.status === "running";
  }
  configureAutomatic(enabled: boolean, settings: CompileSettings): void {
    this.automatic = enabled && this.options.workspace.access.capabilities.compile;
    this.settings = settings;
    this.documentChanged(this.autoPendingRevision ?? undefined);
  }
  private documentChanged(branchRevision?: number): void {
    const persistence = this.options.document?.getSnapshot().persistence;
    if (!this.initialized || !this.automatic || (this.options.document && persistence?.kind !== "saved")) return;
    const revision = branchRevision ?? (persistence?.kind === "saved" ? persistence.revision : null);
    if (revision === null) return;
    if (revision <= this.autoRevision) return;
    this.autoPendingRevision = Math.max(this.autoPendingRevision ?? 0, revision);
    if (this.busy()) return;
    this.autoRevision = this.autoPendingRevision;
    this.autoPendingRevision = null;
    void this.compile({ scope: this.options.workspace.scope, expectedRevision: revision,
      settings: this.settings, clean: false }).catch(error => this.report(error));
  }
  private async access() {
    const { client, workspace } = this.options;
    return editorValue(await client.call(endpoints.projectAccess, {
      params: { p: workspace.scope.projectId }, query: { branch: workspace.scope.branch },
      headers: workspace.requestHeaders, body: undefined,
    }, this.abort.signal));
  }
  readonly compile = async (request: CompileRequest): Promise<CompileJob> => {
    const { client, workspace, document } = this.options;
    if (this.submitting) throw new EditorApiError("COMPILE_PENDING", "A compile request is already being saved");
    this.submitting = true;
    try {
      await this.ready;
      const persistence = document?.getSnapshot().persistence;
      if (persistence?.kind === "offline" || persistence?.kind === "recovery" ||
          persistence?.kind === "closed") {
        throw new EditorApiError("DOCUMENT_UNAVAILABLE", "Reconnect and save source before compiling");
      }
      await document?.flush(this.abort.signal);
      const access = await this.access();
      if (!access.capabilities.compile) throw new EditorApiError("FORBIDDEN", "This project access cannot compile");
      const job = editorValue(await client.call(endpoints.compileCreate, {
        params: { p: workspace.scope.projectId }, query: {},
        body: { ...request, scope: workspace.scope, expectedRevision: access.branchRevision },
        headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
      }, this.abort.signal));
      await this.refresh();
      return job;
    } finally {
      this.submitting = false;
      if (this.autoPendingRevision !== null && !this.busy()) this.documentChanged(this.autoPendingRevision);
    }
  };
  readonly cancel = async (): Promise<void> => {
    const { client, workspace } = this.options;
    const job = this.state.job;
    if (!job || !this.busy()) return;
    const current = await client.callWithMetadata(endpoints.compileGet, {
      params: { id: job.id }, query: {}, body: undefined, headers: workspace.requestHeaders,
    }, this.abort.signal);
    editorValue(current.result);
    const version = current.metadata.expectedVersion;
    if (version === null) throw new EditorApiError("VERSION_MISSING", "Compiler did not return the job version");
    editorValue(await client.call(endpoints.compileCancel, {
      params: { id: job.id }, query: {}, body: { expectedVersion: version },
      headers: workspace.requestHeaders,
    }, this.abort.signal));
  };
  async clearCache(): Promise<void> {
    const { client, workspace } = this.options;
    const project = editorValue(await client.call(endpoints.projectGet, {
      params: { p: workspace.scope.projectId }, query: { branch: workspace.scope.branch },
      body: undefined, headers: workspace.requestHeaders,
    }, this.abort.signal));
    editorValue(await client.call(endpoints.compileCacheDelete, {
      params: { p: workspace.scope.projectId }, query: {},
      body: { scope: workspace.scope, expectedVersion: project.version }, headers: workspace.requestHeaders,
    }, this.abort.signal));
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.unsubscribeDocument?.();
    this.abort.abort();
    await this.events.dispose();
    await this.updates;
    this.listeners.clear();
  }
}
