import { z } from "zod";
import { IdSchema, InstantSchema, CountSchema, JobStatusSchema, Base64Schema } from "./primitives";

export const EventTopicSchema = z.enum([
  "document.saved", "tree.changed", "access.changed", "review.changed", "history.created",
  "git.changed", "job.changed", "operation.changed", "notification.created", "policy.changed",
]);
const versionPayload = z.strictObject({ resourceId: IdSchema, version: CountSchema }).readonly();
const revisionPayload = z.strictObject({ resourceId: IdSchema, revision: CountSchema, epoch: CountSchema }).readonly();
const jobPayload = z.strictObject({ resourceId: IdSchema, status: JobStatusSchema }).readonly();
export const EventPayloadSchemas = {
  "document.saved": revisionPayload, "tree.changed": versionPayload, "access.changed": versionPayload,
  "review.changed": versionPayload, "history.created": versionPayload, "git.changed": versionPayload,
  "job.changed": jobPayload, "operation.changed": jobPayload, "notification.created": versionPayload,
  "policy.changed": versionPayload,
} as const;
const eventFields = {
  seq: CountSchema, id: IdSchema, aggregateId: IdSchema, at: InstantSchema,
} as const;
export const EventSchema = z.discriminatedUnion("topic", [
  z.strictObject({ ...eventFields, topic: z.literal("document.saved"), payload: revisionPayload }),
  z.strictObject({ ...eventFields, topic: z.literal("tree.changed"), payload: versionPayload }),
  z.strictObject({ ...eventFields, topic: z.literal("access.changed"), payload: versionPayload }),
  z.strictObject({ ...eventFields, topic: z.literal("review.changed"), payload: versionPayload }),
  z.strictObject({ ...eventFields, topic: z.literal("history.created"), payload: versionPayload }),
  z.strictObject({ ...eventFields, topic: z.literal("git.changed"), payload: versionPayload }),
  z.strictObject({ ...eventFields, topic: z.literal("job.changed"), payload: jobPayload }),
  z.strictObject({ ...eventFields, topic: z.literal("operation.changed"), payload: jobPayload }),
  z.strictObject({ ...eventFields, topic: z.literal("notification.created"), payload: versionPayload }),
  z.strictObject({ ...eventFields, topic: z.literal("policy.changed"), payload: versionPayload }),
]).readonly();
export const RealtimeClientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("sync"), fileId: IdSchema, epoch: CountSchema, stateVectorBase64: Base64Schema,
  }),
  z.strictObject({
    type: z.literal("update"), fileId: IdSchema, epoch: CountSchema, clientId: IdSchema,
    clientSeq: CountSchema, updateBase64: Base64Schema,
  }),
  z.strictObject({
    type: z.literal("presence"), fileId: IdSchema, cursor: z.string().nullable(), name: z.string(),
  }),
]);
export const RealtimeServerMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ack"), clientId: IdSchema, clientSeq: CountSchema, revision: CountSchema }),
  z.strictObject({
    type: z.literal("update"), fileId: IdSchema, epoch: CountSchema, revision: CountSchema, updateBase64: Base64Schema,
  }),
  z.strictObject({
    type: z.literal("presence"), fileId: IdSchema, userId: IdSchema, cursor: z.string().nullable(), name: z.string(),
  }),
  z.strictObject({
    type: z.literal("error"), code: z.string(), message: z.string(), recoveryText: z.string().nullable(),
  }),
]);
export type Event = z.infer<typeof EventSchema>;
export type EventTopic = z.infer<typeof EventTopicSchema>;
export type RealtimeClientMessage = z.infer<typeof RealtimeClientMessageSchema>;
export type RealtimeServerMessage = z.infer<typeof RealtimeServerMessageSchema>;
