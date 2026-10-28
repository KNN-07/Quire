import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DigestSchema, IdSchema } from "@quire/contracts";
import { ControlError } from "./model";
import { canonicalJson } from "./protocol";
import { ExecutionRequestSchema } from "./execution-model";
import type { ControlledRoleSession } from "./controller-server";

export const ExecutionCommandSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("start"), input: ExecutionRequestSchema }),
  z.strictObject({ method: z.literal("inspect"), input: z.strictObject({ id: IdSchema }) }),
  z.strictObject({ method: z.literal("watch"), input: z.strictObject({ id: IdSchema }) }),
  z.strictObject({ method: z.literal("stop"), input: z.strictObject({ id: IdSchema }) }),
  z.strictObject({ method: z.literal("release"), input: z.strictObject({ id: IdSchema }) }),
  z.strictObject({ method: z.literal("read"), input: z.strictObject({
    id: IdSchema, stream: z.enum(["stdout", "stderr"]), offset: z.number().int().nonnegative(),
    maximumBytes: z.number().int().min(1).max(32768),
  }) }),
]).readonly();
export type ExecutionCommand = z.infer<typeof ExecutionCommandSchema>;
export const ExecutionEnvelopeSchema = z.strictObject({
  protocolVersion: z.literal(1), parentExecutionId: IdSchema, supervisorEpoch: IdSchema,
  generation: z.number().int().nonnegative(), command: ExecutionCommandSchema, mac: DigestSchema,
}).readonly();
export function signExecutionCommand(session: ControlledRoleSession, command: ExecutionCommand) {
  const body = {
    protocolVersion: 1, parentExecutionId: session.permit.execution.id,
    supervisorEpoch: session.permit.execution.supervisorEpoch, generation: session.permit.execution.generation, command,
  };
  return ExecutionEnvelopeSchema.parse({ ...body,
    mac: createHmac("sha256", Buffer.from(session.permit.token, "hex")).update(canonicalJson(body)).digest("hex") });
}
export function authenticateExecutionCommand(input: unknown, token: string) {
  const envelope = ExecutionEnvelopeSchema.parse(input);
  const { mac, ...body } = envelope;
  const expected = createHmac("sha256", Buffer.from(token, "hex")).update(canonicalJson(body)).digest();
  if (!timingSafeEqual(expected, Buffer.from(mac, "hex"))) throw new ControlError("CONTROL_EXECUTION_UNAUTHENTICATED");
  return envelope;
}
