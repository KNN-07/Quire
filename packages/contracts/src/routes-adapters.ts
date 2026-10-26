import { z } from "zod";
import { routesFor, none, noBody, list, version, key } from "./route-builders";
import { IdSchema as id, ScopeSchema as scope, OkSchema, pageSchema } from "./primitives";
import { IdParamsSchema as ids, ProjectParamsSchema as p, ProjectIdParamsSchema as pi, BytesSchema } from "./endpoint";
import { AiRunSchema, OperationSchema, AdapterGrantSchema, PublicationSchema, LibraryEntrySchema } from "./work";
import { ImportFormSchema, ImportSourceSchema } from "./multipart";

const r = routesFor("X");
export const AdapterActions = {
  github: ["listRepositories", "import", "exportNew", "pull", "push", "disconnect"],
  gitlab: ["listRepositories", "import", "exportNew", "pull", "push", "disconnect"],
  git: ["clone", "fetch", "push"], dropbox: ["initialSync", "sync", "disconnect"],
  zotero: ["librarySync", "bulkBib", "refresh"], mendeley: ["bulkBib", "search", "refresh"],
  readcube: ["bulkBib", "search", "refresh"], doi: ["lookup"],
  crossref: ["search"], arxiv: ["search"], semanticScholar: ["search"], dimensions: ["search"],
  publisher: ["prepare", "submit", "status"], billing: ["quote", "checkout", "cancel", "invoices"],
  smtp: ["send"], localMail: ["send"],
} as const;
export type AdapterProvider = keyof typeof AdapterActions;
export type AdapterAction<P extends AdapterProvider> = (typeof AdapterActions)[P][number];
export const AiToolSchema = z.enum([
  "chat", "texgpt", "error-fix", "table-prompt", "table-image", "equation-prompt", "equation-image",
  "grammar", "fluency", "paraphrase", "concise", "scientific", "split", "join", "synonyms",
  "title", "abstract", "translate", "inline-completion", "citation-reviewer",
]);
export type AiTool = z.infer<typeof AiToolSchema>;
export const adapterEndpoints = {
  importCreate: r("POST", "/api/imports", { params: none, query: none, body: z.union([ImportFormSchema, z.strictObject({ kind: z.enum(["zip", "docx", "markdown", "git", "github", "open-in"]), name: z.string(), workspaceId: id.optional(), source: ImportSourceSchema })]), output: OperationSchema, ...key, successStatus: 202 }),
  libraryDoi: r("POST", "/api/me/library/doi", { params: none, query: none, body: z.strictObject({ doi: z.string() }), output: LibraryEntrySchema, ...key }),
  referencesSearch: r("GET", "/api/references/search", { params: none, query: list.extend({ projectId: id, query: z.string(), provider: z.string(), fields: z.string().optional() }), body: noBody, output: pageSchema(PublicationSchema) }),
  connectionsList: r("GET", "/api/connections", { params: none, query: list, body: noBody, output: pageSchema(AdapterGrantSchema) }),
  connectionStart: r("POST", "/api/connections/:provider/start", { params: z.strictObject({ provider: z.string() }), query: none, body: z.strictObject({ returnTo: z.string() }), output: z.strictObject({ url: z.url() }) }),
  connectionCallback: r("GET", "/api/connections/:provider/callback", { params: z.strictObject({ provider: z.string() }), query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }), body: noBody, output: BytesSchema, transport: "bytes" }),
  connectionTest: r("POST", "/api/connections/:id/test", { params: ids, query: none, body: z.strictObject(version), output: z.strictObject({ ok: z.boolean(), reason: z.string().optional() }) }),
  connectionDelete: r("DELETE", "/api/connections/:id", { params: ids, query: none, body: z.strictObject(version), output: OkSchema }),
  connectionAction: r("POST", "/api/connections/:id/actions", { params: ids, query: none, body: z.strictObject({ action: z.string().min(1), projectId: id.optional(), parameters: z.record(z.string(), z.unknown()), expectedCursor: z.string().nullable().optional(), ...version }), output: OperationSchema, ...key, successStatus: 202 }),
  aiRunCreate: r("POST", "/api/projects/:p/ai/runs", { params: p, query: none, body: z.strictObject({ scope, mode: z.enum(["ask", "agent"]), tool: AiToolSchema, prompt: z.string(), fileIds: z.array(id), selection: z.strictObject({ fileId: id, from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), text: z.string() }).optional(), diagnosticId: id.optional(), imageUploadIds: z.array(id).optional(), conversationId: id.optional() }), output: AiRunSchema, ...key, successStatus: 202 }),
  aiRunGet: r("GET", "/api/ai/runs/:id", { params: ids, query: none, body: noBody, output: AiRunSchema }),
  aiRunCancel: r("POST", "/api/ai/runs/:id/cancel", { params: ids, query: none, body: z.strictObject(version), output: OkSchema }),
  aiRunDecide: r("POST", "/api/ai/runs/:id/decide", { params: ids, query: none, body: z.strictObject({ editIds: z.array(id), decision: z.enum(["accept", "reject"]), commit: z.boolean().optional(), newBranch: z.string().optional(), ...version }), output: AiRunSchema, ...key }),
  aiRunUndo: r("POST", "/api/ai/runs/:id/undo", { params: ids, query: none, body: z.strictObject({ editIds: z.array(id), ...version }), output: AiRunSchema, ...key }),
  aiConversationDelete: r("DELETE", "/api/projects/:p/ai/conversations/:id", { params: pi, query: none, body: z.strictObject(version), output: OkSchema }),
} as const;
