import type {
  CompileJob, CompileRequest, Diagnostic, FileEntry, Id,
  Preferences, Project, RequestOf, ResponseOf, Scope, Thread, Version, createClient, endpoints,
} from "@quire/contracts";
import type { ReactNode } from "react";
import type { Doc, Text } from "yjs";
import type { Awareness } from "y-protocols/awareness";
import type { SourceCommand } from "../source/editor";

export type EditorClient = ReturnType<typeof createClient>;
export type EditorPageProps = {
  readonly path: string;
  readonly client: EditorClient;
  readonly navigate: (path: string) => void;
  readonly onSessionChange: () => Promise<void>;
};
export type EffectiveAccess = ResponseOf<typeof endpoints.projectAccess>;
export type EditorRequestHeaders = Readonly<Pick<
  NonNullable<RequestOf<typeof endpoints.projectAccess>["headers"]>, "x-project-token"
>>;
export type EditorWorkspace = {
  readonly scope: Scope;
  readonly project: Project;
  readonly access: EffectiveAccess;
  readonly files: readonly FileEntry[];
  /** Forward on every scoped HTTP request; never merge into a global client. */
  readonly requestHeaders: EditorRequestHeaders;
};

/** Offsets are zero-based UTF-16 code units, matching Y.Text and CodeMirror. */
export type SourceSelection = { readonly anchor: number; readonly head: number };
/** Non-overlapping replacements use offsets in the pre-transaction source. */
export type SourceEdit = { readonly from: number; readonly to: number; readonly insert: string };
export type SourceLocation = {
  readonly fileId: Id;
  /** SyncTeX/source diagnostics use one-based lines and columns. */
  readonly line: number;
  readonly column: number;
};
export type PdfLocation = {
  readonly page: number;
  readonly xPt: number;
  readonly yPt: number;
};
export type PersistenceStatus =
  | { readonly kind: "connecting" }
  | { readonly kind: "saved"; readonly revision: number }
  | { readonly kind: "saving"; readonly acknowledgedRevision: number; readonly pendingUpdates: number }
  | { readonly kind: "offline"; readonly pendingUpdates: number; readonly editable: boolean; readonly since: number }
  | { readonly kind: "recovery"; readonly code: string; readonly message: string;
      readonly localText: string; readonly serverText: string | null }
  | { readonly kind: "closed"; readonly reason: string };
export type DocumentSnapshot = {
  readonly version: Version;
  readonly persistence: PersistenceStatus;
  readonly readOnly: boolean;
  readonly readOnlyReason: string | null;
};
/** Transport alone creates/destroys the document, awareness, queue and socket. */
export interface EditorDocument {
  readonly scope: Scope;
  readonly file: FileEntry;
  readonly ydoc: Doc;
  readonly source: Text;
  readonly awareness: Awareness;
  readonly getSnapshot: () => DocumentSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  /** Apply one atomic local edit; reject when read-only. Never claim persistence here. */
  readonly replace: (edits: readonly SourceEdit[]) => void;
  /** Resolve only after matching durable acknowledgments; reject on recovery/closure. */
  readonly flush: (signal?: AbortSignal) => Promise<void>;
}
export interface AuthoringHandle {
  readonly focus: () => void;
  readonly select: (selection: SourceSelection) => void;
  readonly reveal: (location: SourceLocation) => void;
  readonly replaceSelection: (text: string) => void;
}
export type EditorNavigation = {
  readonly openFile: (fileId: Id) => Promise<void>;
  readonly revealSource: (location: SourceLocation) => Promise<void>;
  readonly revealPdf: (location: PdfLocation) => void;
  readonly changeBranch: (branch: Scope["branch"]) => Promise<void>;
};
export type CompileState = ResponseOf<typeof endpoints.compilePreview>;
export interface CompileController {
  readonly getSnapshot: () => CompileState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly compile: (request: CompileRequest) => Promise<CompileJob>;
  readonly cancel: () => Promise<void>;
}
export type AuthoringProps = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly navigation: EditorNavigation;
  readonly refreshWorkspace: () => Promise<void>;
  readonly document: EditorDocument;
  readonly preferences: Preferences;
  /** Publish the actual preferencesPatch response only after successful persistence. */
  readonly onPreferencesChange: (preferences: Preferences) => void;
  readonly selection: SourceSelection;
  readonly onSelectionChange: (selection: SourceSelection) => void;
  readonly onHandle: (handle: AuthoringHandle | null) => void;
  readonly diagnostics: readonly Diagnostic[];
};
export type SourceTool = "find" | "outline" | "check" | "preferences" | "shortcuts";
export interface SourceToolsHandle {
  readonly open: (tool: SourceTool) => void;
  readonly close: () => void;
  readonly format: (command: SourceCommand) => boolean;
  readonly readOnly?: boolean;
}
export type SourcePanelProps = AuthoringProps & {
  /** Embedded callers must expose every standalone toolbar action. */
  readonly presentation?: "standalone" | "embedded";
  readonly onToolsHandle?: (handle: SourceToolsHandle | null) => void;
  readonly onTrackingChange?: (enabled: boolean) => void;
};
export type VisualPanelProps = AuthoringProps;
export type ToolsPanelProps = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly document: EditorDocument | null;
  readonly authoring: AuthoringHandle | null;
  readonly navigation: EditorNavigation;
  readonly refreshWorkspace: () => Promise<void>;
};
export type PdfPanelProps = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly document: EditorDocument | null;
  readonly preferences: Preferences;
  readonly navigation: EditorNavigation;
  readonly onController: (controller: CompileController | null) => void;
  readonly onCompileStateChange: (state: CompileState) => void;
};
export type ReviewThreadRequest = {
  readonly key: string;
  readonly thread: Thread;
  readonly version: number;
};
export type ReviewPanelProps = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly document: EditorDocument | null;
  readonly selection: SourceSelection;
  readonly navigation: EditorNavigation;
  readonly refreshWorkspace: () => Promise<void>;
  readonly view: "review" | "history" | "share" | "chat";
  readonly onAskThread?: (request: ReviewThreadRequest) => void;
};
export type GitPanelProps = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly document: EditorDocument | null;
  readonly navigation: EditorNavigation;
  readonly refreshWorkspace: () => Promise<void>;
};
export type EditorLayout = Preferences["defaultView"] | "stacked";
export type EditorPanel = "files" | "search" | "symbols" | "bibliography" | "review" | "history" | "git" | "logs";
/** Assembly owns geometry. Producers provide real nodes, not another application shell. */
export type EditorSlots = {
  readonly header: ReactNode;
  readonly tools: ReactNode;
  readonly source: ReactNode;
  readonly visual: ReactNode;
  readonly pdf: ReactNode;
  readonly review: ReactNode;
  readonly git: ReactNode;
  readonly status: ReactNode;
  /** Supplied only after the real adapter/assistant phase; no placeholder controls. */
  readonly assistant?: ReactNode;
};
