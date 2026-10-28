import type { Diagnostic, ResponseOf, endpoints } from "@quire/contracts";
import type {
  CompileController, EditorClient, EditorDocument, EditorNavigation,
  EditorWorkspace, SourceSelection,
} from "../shared";

export type AssistantPanelProps = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly document: EditorDocument | null;
  readonly selection: SourceSelection;
  readonly navigation: EditorNavigation;
  readonly compile: CompileController | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly refreshWorkspace: () => Promise<void>;
};
export type Conversation = ResponseOf<typeof endpoints.aiConversationGet>;
export type Security = ResponseOf<typeof endpoints.aiSecurityGet>;
export type Usage = ResponseOf<typeof endpoints.aiUsageGet>;
export type AiConsentMetadata = ResponseOf<typeof endpoints.aiConsentGet>;
