import { z } from "zod";
import { AiRunSchema, endpoints, IdSchema, ProposedEditSchema } from "@quire/contracts";
import type { Id, Scope } from "@quire/contracts";
import type { Principal } from "@quire/runtime";

export const CreateRunSchema = endpoints.aiRunCreate.input.shape.body;
export type CreateRun = z.infer<typeof CreateRunSchema>;
export type Actor = Pick<Principal, "sessionId"> & { readonly id: Id };
export const MessageSchema = z.strictObject({ role: z.enum(["user", "assistant"]), text: z.string() });
export const MessagesSchema = z.array(MessageSchema);
export const PatchSchema = z.strictObject({
  fileId: IdSchema, path: z.string().min(1), from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(), before: z.string(), after: z.string(),
});
export const AnswerSchema = z.strictObject({
  text: z.string().max(262144), patches: z.array(PatchSchema).max(100),
  citations: z.array(z.strictObject({ provider: z.string(), providerId: z.string() })).max(100),
});
export type Patch = z.infer<typeof PatchSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export const RunRecordSchema = z.object({
  id: IdSchema, actor_id: IdSchema, session_id: IdSchema, project_id: IdSchema,
  branch: z.string(), mode: z.enum(["ask", "agent"]), status: AiRunSchema.unwrap().shape.status,
  messages_json: z.string(), proposals_json: z.string(), sources_json: z.string(),
  usage_id: IdSchema, version: z.number().int(), config_version: z.number().int(),
  conversation_id: IdSchema.nullable(), request_json: z.string(), error_code: z.string().nullable(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;
export const UndoSchema = z.record(z.string(), ProposedEditSchema);
export type SelectedFile = {
  readonly id: Id; readonly path: string; readonly text: string; readonly state: string;
  readonly epoch: number; readonly revision: number; readonly from: number; readonly to: number;
};
export type RunContext = {
  readonly files: readonly SelectedFile[];
  readonly images: readonly { readonly mime: "image/png" | "image/jpeg"; readonly bytes: Uint8Array }[];
  readonly diagnostic: string | null;
};
export const scopeOf = (run: RunRecord): Scope => ({ projectId: run.project_id, branch: run.branch });
export const actorOf = (run: RunRecord): Actor => ({ id: run.actor_id, sessionId: run.session_id });
export const newId = (): Id => IdSchema.parse(crypto.randomUUID());
export const digest = (input: string): string => new Bun.CryptoHasher("sha256").update(input).digest("hex");
