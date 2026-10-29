import type { Diagnostic, Preferences, ResponseOf, endpoints } from "@quire/contracts";
import type { DiagnosticFixRequest } from "../pdf";
import type {
  AuthoringHandle, CompileController, EditorClient, EditorDocument, EditorNavigation,
  EditorWorkspace, ReviewThreadRequest, SourceSelection,
} from "../shared";

export type AssistantPanelProps = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly document: EditorDocument | null;
  readonly selection: SourceSelection;
  readonly navigation: EditorNavigation;
  readonly compile: CompileController | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly preferences?: Preferences;
  readonly onPreferencesChange?: (preferences: Preferences) => void;
  readonly diagnosticFix?: DiagnosticFixRequest | null;
  readonly onClearDiagnosticFix?: () => void;
  readonly threadContext?: ReviewThreadRequest | null;
  readonly onClearThreadContext?: () => void;
  readonly refreshWorkspace: () => Promise<void>;
  readonly authoring?: AuthoringHandle | null;
  readonly citationClient?: EditorClient;
  readonly tracking?: boolean;
};
export type Conversation = ResponseOf<typeof endpoints.aiConversationGet>;
export type Security = ResponseOf<typeof endpoints.aiSecurityGet>;
export type Usage = ResponseOf<typeof endpoints.aiUsageGet>;
export type AiConsentMetadata = ResponseOf<typeof endpoints.aiConsentGet>;
