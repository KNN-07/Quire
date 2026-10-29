import { z } from "zod";
import { routesFor, none, noBody, list, version, key } from "./route-builders";
import { IdSchema as id, ScopeSchema as scope, OkSchema, pageSchema, CapabilitySchema } from "./primitives";
import { IdParamsSchema as ids, ProjectParamsSchema as p, ProjectIdParamsSchema as pi, BytesSchema } from "./endpoint";
import { AiRunSchema, AiToolSchema, OperationSchema, AdapterGrantSchema, PublicationSchema, LibraryEntrySchema } from "./work";
import { ImportFormSchema, ImportSourceSchema, ImportSelectionSchema, ImportUploadFormSchema, ImportUploadSchema } from "./multipart";

const r = routesFor("X");
export const AdapterActions = {
  github: ["listRepositories", "import", "exportNew", "pull", "push", "disconnect"],
  gitlab: ["listRepositories", "import", "exportNew", "pull", "push", "disconnect"],
  git: ["clone", "fetch", "push"], dropbox: ["discoverFolders", "inspectFolder", "importFolder", "reauthorizeFolderImport", "initialSync", "sync", "disconnect"],
  zotero: ["librarySync", "bulkBib", "refresh"], mendeley: ["bulkBib", "search", "refresh", "groups"],
  readcube: ["bulkBib", "search", "refresh"], doi: ["lookup"],
  crossref: ["search"], arxiv: ["search"], semanticScholar: ["search"], dimensions: ["search"],
  publisher: ["prepare", "submit", "status"], billing: ["quote", "checkout", "cancel", "invoices"],
  smtp: ["send"], localMail: ["send"],
} as const;
export type AdapterProvider = keyof typeof AdapterActions;
export type AdapterAction<P extends AdapterProvider> = (typeof AdapterActions)[P][number];
export const DropboxFolderSchema = z.strictObject({
  id: z.string().min(1), path: z.string().min(1), projectId: id.nullable(),
});
export const DropboxFoldersResultSchema = z.strictObject({ folders: z.array(DropboxFolderSchema) });
export const DropboxFolderInspectionSchema = z.strictObject({
  folder: DropboxFolderSchema, mainPaths: z.array(z.string()), fileCount: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  pendingImport: z.strictObject({
    name: z.string(), mainPath: z.string(), preparedAt: z.iso.datetime(), requiresReauthorization: z.boolean(),
  }).nullable().default(null),
});
export const DropboxFolderImportSchema = z.strictObject({
  projectId: id, folderId: z.string(), path: z.string(), recovered: z.boolean(),
});
export { AiToolSchema } from "./work";
export type { AiTool } from "./work";
const aiConversation = z.strictObject({
  id, projectId: id, version: z.number().int().nonnegative(),
  messages: z.array(z.strictObject({ role: z.enum(["user", "assistant"]), text: z.string() })),
});
const aiSecurity = z.strictObject({ confidential: z.boolean(), version: z.number().int().nonnegative() });
export const adapterEndpoints = {
  importCreate: r("POST", "/api/imports", { params: none, query: none, body: z.union([ImportFormSchema, z.strictObject({ kind: z.enum(["zip", "docx", "markdown", "git", "github", "open-in"]), name: z.string(), workspaceId: id.optional(), source: ImportSourceSchema, ...ImportSelectionSchema.unwrap().shape })]), output: OperationSchema, ...key, successStatus: 202 }),
  importUploadCreate: r("POST", "/api/import-uploads", { params: none, query: none, body: ImportUploadFormSchema, output: ImportUploadSchema, ...key, successStatus: 201 }),
  importUploadGet: r("GET", "/api/import-uploads/:id", { params: ids, query: none, body: noBody, output: ImportUploadSchema }),
  importUploadContent: r("GET", "/api/import-uploads/:id/content", { params: ids, query: none, body: noBody, output: BytesSchema, transport: "bytes" }),
  libraryDoi: r("POST", "/api/me/library/doi", { params: none, query: none, body: z.strictObject({ doi: z.string() }), output: LibraryEntrySchema, ...key }),
  referencesSearch: r("GET", "/api/references/search", { params: none, query: list.extend({ projectId: id, query: z.string(), provider: z.string(), fields: z.string().optional() }), body: noBody, output: pageSchema(PublicationSchema) }),
  connectionAvailability: r("GET", "/api/connections/availability", { params: none, query: none, body: noBody, output: z.record(z.string(), CapabilitySchema) }),
  connectionCredentials: r("POST", "/api/connections/:provider/credentials", { params: z.strictObject({ provider: z.literal("zotero") }), query: none, body: z.strictObject({ accessToken: z.string().min(1).max(512), label: z.string().min(1).max(200) }), output: AdapterGrantSchema }),
  gitCredentials: r("POST", "/api/connections/git/credentials", { params: none, query: none, body: z.strictObject({ label: z.string().min(1).max(200), url: z.url(), username: z.string().min(1).max(512), secret: z.string().min(1).max(4096) }), output: AdapterGrantSchema }),
  dropboxPolicyGet: r("GET", "/api/dropbox/policies/:scopeKind/:id", { params: ids.extend({ scopeKind: z.enum(["organization", "project"]) }), query: none, body: noBody, output: z.strictObject({ enabled: z.boolean(), effectiveEnabled: z.boolean(), version: z.number().int().nonnegative() }) }),
  dropboxPolicyPut: r("PUT", "/api/dropbox/policies/:scopeKind/:id", { params: ids.extend({ scopeKind: z.enum(["organization", "project"]) }), query: none, body: z.strictObject({ enabled: z.boolean(), ...version }), output: z.strictObject({ enabled: z.boolean(), effectiveEnabled: z.boolean(), version: z.number().int().nonnegative() }) }),
  connectionsList: r("GET", "/api/connections", { params: none, query: list, body: noBody, output: pageSchema(AdapterGrantSchema) }),
  connectionStart: r("POST", "/api/connections/:provider/start", { params: z.strictObject({ provider: z.string() }), query: none, body: z.strictObject({ returnTo: z.string() }), output: z.strictObject({ url: z.url() }) }),
  connectionCallback: r("GET", "/api/connections/:provider/callback", { params: z.strictObject({ provider: z.string() }), query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }), body: noBody, output: BytesSchema, transport: "bytes" }),
  connectionTest: r("POST", "/api/connections/:id/test", { params: ids, query: none, body: z.strictObject(version), output: z.strictObject({ ok: z.boolean(), reason: z.string().optional() }) }),
  connectionCursor: r("GET", "/api/connections/:id/cursor", { params: ids, query: z.strictObject({ action: z.string().min(1), projectId: id.optional() }), body: noBody, output: z.strictObject({ cursor: z.string().nullable(), grantVersion: z.number().int().nonnegative() }) }),
  connectionDelete: r("DELETE", "/api/connections/:id", { params: ids, query: none, body: z.strictObject(version), output: OkSchema }),
  connectionAction: r("POST", "/api/connections/:id/actions", { params: ids, query: none, body: z.strictObject({ action: z.string().min(1), projectId: id.optional(), parameters: z.record(z.string(), z.unknown()), expectedCursor: z.string().nullable().optional(), ...version }), output: OperationSchema, ...key, successStatus: 202 }),
  aiRunCreate: r("POST", "/api/projects/:p/ai/runs", { params: p, query: none, body: z.strictObject({ scope, mode: z.enum(["ask", "agent"]), tool: AiToolSchema, prompt: z.string(), fileIds: z.array(id), projectSearch: z.boolean().optional(), selection: z.strictObject({ fileId: id, from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), text: z.string() }).optional(), diagnosticId: id.optional(), imageUploadIds: z.array(id).optional(), conversationId: id.optional() }), output: AiRunSchema, ...key, successStatus: 202 }),
  aiRunGet: r("GET", "/api/ai/runs/:id", { params: ids, query: none, body: noBody, output: AiRunSchema }),
  aiRunCancel: r("POST", "/api/ai/runs/:id/cancel", { params: ids, query: none, body: z.strictObject(version), output: OkSchema }),
  aiRunDecide: r("POST", "/api/ai/runs/:id/decide", { params: ids, query: none, body: z.strictObject({ editIds: z.array(id), decision: z.enum(["accept", "reject"]), commit: z.boolean().optional(), newBranch: z.string().optional(), ...version }), output: AiRunSchema, ...key }),
  aiRunUndo: r("POST", "/api/ai/runs/:id/undo", { params: ids, query: none, body: z.strictObject({ editIds: z.array(id), ...version }), output: AiRunSchema, ...key }),
  aiConversationDelete: r("DELETE", "/api/projects/:p/ai/conversations/:id", { params: pi, query: none, body: z.strictObject(version), output: OkSchema }),
  aiImageCreate: r("POST", "/api/projects/:p/ai/images", { params: p, query: none, body: z.strictObject({ mime: z.enum(["image/png", "image/jpeg"]), dataBase64: z.string() }), output: z.strictObject({ id, bytes: z.number().int().nonnegative(), mime: z.enum(["image/png", "image/jpeg"]) }) }),
  aiConversationCreate: r("POST", "/api/projects/:p/ai/conversations", { params: p, query: none, body: z.strictObject({ shared: z.literal(true) }), output: aiConversation }),
  aiConversationGet: r("GET", "/api/projects/:p/ai/conversations/:id", { params: pi, query: none, body: noBody, output: aiConversation }),
  aiUsageGet: r("GET", "/api/me/ai/usage", { params: none, query: z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }), body: noBody, output: z.strictObject({ month: z.string(), used: z.number().nonnegative(), reserved: z.number().nonnegative(), refunded: z.number().nonnegative() }) }),
  aiConsentGet: r("GET", "/api/me/ai/consent", { params: none, query: none, body: noBody, output: z.strictObject({ requiredTermsVersion: z.string(), acceptedTermsVersion: z.string().nullable(), accepted: z.boolean(), current: z.boolean(), userVersion: z.number().int().nonnegative() }) }),
  aiSecurityGet: r("GET", "/api/projects/:p/ai/security", { params: p, query: none, body: noBody, output: aiSecurity }),
  aiSecurityPut: r("PUT", "/api/projects/:p/ai/security", { params: p, query: none, body: z.strictObject({ confidential: z.boolean(), ...version }), output: aiSecurity }),
  aiSessionClear: r("DELETE", "/api/projects/:p/ai/session", { params: p, query: none, body: z.strictObject({ branch: z.string() }), output: z.strictObject({ ok: z.literal(true), version: z.literal(0) }) }),
} as const;
