import { PreferencesSchema, assertNever, endpoints } from "@quire/contracts";
import type { FileEntry, Id, Preferences } from "@quire/contracts";
import { EditorApiError, editorValue, loadEditorWorkspace } from "./shared";
import type { EditorClient, EditorDocument, EditorRoute, EditorWorkspace, PersistenceStatus } from "./shared";
import { createEditorTransport } from "./transport";
import type { EditorTransport } from "./transport";

const guestPreferences = PreferencesSchema.parse({
  theme: "system", bindings: "default", fontSize: 13, fontFamily: "plex", lineHeight: "normal",
  defaultView: "split", defaultEngine: "pdflatex", dictionary: "en-US", spellCheck: true,
  customWords: [], viewer: "builtin", autoCompile: false, autocomplete: true, autoClose: true,
  cursors: true, aiModel: null, aiMode: "ask", aiStyle: "match", citationProviders: [],
  inlineCompletion: false, errorAssist: false, citationWebSearch: false, aiBranch: false,
  shareAiChat: false, compileBeforeCommit: false, version: 0,
});
export type RetainedSource = {
  readonly key: string;
  readonly file: FileEntry;
  readonly text: string;
};
export type EditorSessionReady = {
  readonly kind: "ready";
  readonly workspace: EditorWorkspace;
  readonly document: EditorDocument | null;
  readonly preferences: Preferences;
  readonly userId: Id | null;
  readonly userName: string | null;
  readonly retained: readonly RetainedSource[];
};
export type EditorSessionSnapshot = { readonly kind: "loading" } | EditorSessionReady;

/** Own the one transport lifetime, not the source bytes or a second persistence queue. */
export class EditorSessionController {
  private snapshot: EditorSessionSnapshot = { kind: "loading" };
  private readonly listeners = new Set<() => void>();
  private readonly abort = new AbortController();
  private transport: EditorTransport | null = null;
  private unsubscribeDocument: (() => void) | null = null;
  private preferences = guestPreferences;
  private userId: Id | null = null;
  private userName: string | null = null;
  private retained: readonly RetainedSource[] = [];
  private dirty = false;
  private sequence = 0;
  private closed = false;
  private disposal: Promise<void> | null = null;
  private closingTransport: Promise<void> = Promise.resolve();
  private refreshing: Promise<boolean> | null = null;
  private refreshRequested = false;
  constructor(private readonly client: EditorClient, private readonly route: EditorRoute) {}
  readonly getSnapshot = (): EditorSessionSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(value: EditorSessionSnapshot): void {
    if (this.closed) return;
    this.snapshot = value;
    for (const listener of this.listeners) listener();
  }
  private ready(): EditorSessionReady {
    if (this.closed || this.snapshot.kind !== "ready") throw new EditorApiError("EDITOR_LOADING", "The editor session is not ready");
    return this.snapshot;
  }
  async start(): Promise<void> {
    const account = await this.client.call(endpoints.me, { params: {}, query: {}, body: undefined }, this.abort.signal);
    if ("error" in account && account.error.code !== "UNAUTHENTICATED") editorValue(account);
    if ("data" in account) { this.preferences = account.data.preferences; this.userId = account.data.user.id; this.userName = account.data.user.name; }
    const workspace = await loadEditorWorkspace(this.client, this.route, this.abort.signal);
    await this.open(workspace, null);
  }
  private rememberPersistence(status: PersistenceStatus): void {
    switch (status.kind) {
      case "saved": this.dirty = false; break;
      case "saving": this.dirty = true; break;
      case "offline": this.dirty = status.pendingUpdates > 0; break;
      case "recovery": if (status.code === "READ_ONLY_EDIT") this.dirty = true; break;
      case "connecting": case "closed": break;
      default: assertNever(status);
    }
  }
  private bind(document: EditorDocument | null): void {
    this.unsubscribeDocument?.();
    this.unsubscribeDocument = null;
    this.dirty = false;
    if (document) {
      this.rememberPersistence(document.getSnapshot().persistence);
      this.unsubscribeDocument = document.subscribe(() => this.rememberPersistence(document.getSnapshot().persistence));
    }
  }
  private async open(workspace: EditorWorkspace, selected: Id | null): Promise<void> {
    if (this.closed) return;
    const transport = createEditorTransport({ client: this.client, workspace });
    this.transport = transport;
    const file = workspace.files.find(entry => entry.id === selected && entry.editable)
      ?? workspace.files.find(entry => entry.id === workspace.project.settings.mainFileId && entry.editable)
      ?? workspace.files.find(entry => entry.kind === "file" && entry.editable);
    try {
      const document = file ? await transport.open(file) : null;
      if (this.closed) return;
      this.bind(document);
      this.publish({ kind: "ready", workspace, document, preferences: this.preferences, userId: this.userId, userName: this.userName, retained: this.retained });
    } catch (cause) { await this.closeTransport(); throw cause; }
  }
  private closeTransport(): Promise<void> {
    const owned = this.transport;
    this.transport = null;
    if (owned) this.closingTransport = this.closingTransport.then(() => owned.dispose());
    return this.closingTransport;
  }
  readonly settle = async (): Promise<void> => {
    const { document } = this.ready();
    const status = document?.getSnapshot().persistence;
    if (status?.kind === "offline" || status?.kind === "recovery" || status?.kind === "closed") {
      throw new EditorApiError("DOCUMENT_UNAVAILABLE", "Reconnect or recover retained source before leaving this document");
    }
    if (this.retained.length) throw new EditorApiError("RECOVERY_REQUIRED", "Copy retained local source or explicitly discard its recovery copy before leaving");
    await document?.flush(AbortSignal.timeout(30_000));
  };
  readonly openFile = async (fileId: Id): Promise<void> => {
    await this.settle();
    const current = this.ready();
    if (current.document?.file.id === fileId) return;
    const file = current.workspace.files.find(entry => entry.id === fileId);
    if (!file) throw new EditorApiError("FILE_NOT_FOUND", "The selected file no longer exists");
    const transport = this.transport;
    if (!transport) throw new EditorApiError("EDITOR_CLOSED", "The document transport is closed");
    const request = ++this.sequence;
    const document = await transport.open(file);
    if (request !== this.sequence || this.closed) return;
    this.bind(document);
    this.publish({ ...current, document });
  };
  readonly refresh = (): Promise<boolean> => {
    this.refreshRequested = true;
    return this.refreshing ??= (async () => {
      let replaced = false;
      do {
        this.refreshRequested = false;
        const current = this.ready();
        const request = ++this.sequence;
        const workspace = await loadEditorWorkspace(this.client, this.route, this.abort.signal);
        if (request !== this.sequence || this.closed) return replaced;
        if (this.refreshRequested) continue;
        const changed = current.workspace.files.some(previous => {
          const next = workspace.files.find(file => file.id === previous.id);
          return !next || next.version.epoch !== previous.version.epoch || next.path !== previous.path;
        });
        if (!changed) {
          this.publish({ ...current, workspace });
        } else {
          replaced = true;
          if (current.document && this.dirty) {
            this.retained = [...this.retained, { key: crypto.randomUUID(), file: current.document.file, text: current.document.source.toJSON() }];
          }
          this.publish({ kind: "loading" });
          this.unsubscribeDocument?.(); this.unsubscribeDocument = null;
          await this.closeTransport();
          if (request !== this.sequence || this.closed) return replaced;
          await this.open(workspace, current.document?.file.id ?? null);
        }
      } while (this.refreshRequested);
      return replaced;
    })().finally(() => { this.refreshing = null; });
  };
  readonly updatePreferences = (preferences: Preferences): void => {
    this.preferences = preferences;
    if (this.snapshot.kind === "ready") this.publish({ ...this.snapshot, preferences });
  };
  readonly join = async (): Promise<void> => {
    const { workspace } = this.ready();
    editorValue(await this.client.call(endpoints.projectJoin, {
      params: { p: workspace.scope.projectId }, query: {}, body: { scope: workspace.scope },
      headers: workspace.requestHeaders,
    }, this.abort.signal));
    await this.refresh();
    this.transport?.reconnect();
  };
  readonly discardRecovery = (key: string): void => {
    this.retained = this.retained.filter(entry => entry.key !== key);
    if (this.snapshot.kind === "ready") this.publish({ ...this.snapshot, retained: this.retained });
  };
  readonly path = async (page: EditorRoute["page"], branch?: string): Promise<string> => {
    await this.settle();
    const { workspace } = this.ready();
    const target = branch ?? workspace.scope.branch;
    const url = new URL(`/projects/${workspace.scope.projectId}/${page}`, location.origin);
    url.searchParams.set("branch", target);
    if (this.route.shareToken) url.searchParams.set("share", this.route.shareToken);
    if (target !== workspace.scope.branch) await this.dispose();
    return url.pathname + url.search;
  };
  readonly dispose = (): Promise<void> => {
    this.disposal ??= (async () => {
      this.closed = true; this.sequence++; this.abort.abort();
      this.unsubscribeDocument?.(); this.unsubscribeDocument = null;
      await this.closeTransport();
      this.listeners.clear();
    })();
    return this.disposal;
  };
}
