import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DigestSchema, IdSchema, InstantSchema } from "@quire/contracts";
import type { Digest, Instant } from "@quire/contracts";
import {
  ControlError, InstallationIdSchema, RecoveryRequestSchema,
  ReservedUpdateCommandSchema, UpdateOperationQuerySchema,
} from "./model";

/** Canonical JSON for parsed request bodies; raw legacy bytes never pass here. */
export function canonicalJson(value: unknown): string {
  const parsed = z.json().parse(value);
  function encode(input: z.infer<ReturnType<typeof z.json>>): string {
    if (input === null || typeof input !== "object") return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(encode).join(",")}]`;
    return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${encode(z.json().parse(input[key]))}`).join(",")}}`;
  }
  return encode(parsed);
}
export function controlDigest(bytes: string | Uint8Array): Digest {
  return DigestSchema.parse(createHash("sha256").update(bytes).digest("hex"));
}
export function requestDigest(request: z.infer<typeof ReservedUpdateCommandSchema>["request"]): Digest {
  return controlDigest(canonicalJson(request));
}
export const ControlCommandSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("submit"), input: ReservedUpdateCommandSchema }),
  z.strictObject({ method: z.literal("get"), input: z.strictObject({ id: IdSchema }) }),
  z.strictObject({ method: z.literal("list"), input: UpdateOperationQuerySchema }),
  z.strictObject({ method: z.literal("releases"), input: z.strictObject({}) }),
  z.strictObject({ method: z.literal("status"), input: z.strictObject({}) }),
  z.strictObject({ method: z.literal("recover"), input: RecoveryRequestSchema }),
]).readonly();
export type ControlCommand = z.infer<typeof ControlCommandSchema>;
export const ControlEnvelopeSchema = z.strictObject({
  protocolVersion: z.literal(1), installationId: InstallationIdSchema,
  credentialId: IdSchema, requestId: IdSchema, issuedAt: InstantSchema,
  command: ControlCommandSchema, mac: DigestSchema,
}).readonly();
export type ControlEnvelope = z.infer<typeof ControlEnvelopeSchema>;
export interface ControlCredential {
  readonly id: z.infer<typeof IdSchema>;
  readonly installationId: string;
  readonly channel: "api" | "operator";
  readonly secret: Uint8Array;
}
function signedBytes(envelope: Omit<ControlEnvelope, "mac">): string {
  return canonicalJson(envelope);
}
export function signControlCommand(
  input: Omit<ControlEnvelope, "mac">, credential: ControlCredential,
): ControlEnvelope {
  if (credential.secret.byteLength < 32) throw new ControlError("CONTROL_CREDENTIAL_INVALID");
  return ControlEnvelopeSchema.parse({
    ...input, mac: createHmac("sha256", credential.secret).update(signedBytes(input)).digest("hex"),
  });
}
export class AuthenticatedControlCommand {
  readonly #authenticatedChannel: ControlCredential["channel"];
  private constructor(
    readonly envelope: ControlEnvelope,
    channel: ControlCredential["channel"],
  ) { this.#authenticatedChannel = channel; }
  get channel(): ControlCredential["channel"] { return this.#authenticatedChannel; }
  static authenticate(
    input: unknown, credential: ControlCredential, now: Instant, maxAgeMs = 30_000,
  ): AuthenticatedControlCommand {
    const envelope = ControlEnvelopeSchema.parse(input);
    const { mac, ...body } = envelope;
    if (credential.secret.byteLength < 32 || envelope.credentialId !== credential.id ||
        envelope.installationId !== credential.installationId ||
        !Number.isFinite(maxAgeMs) || maxAgeMs < 0 ||
        Date.parse(envelope.issuedAt) > Date.parse(now) ||
        Date.parse(now) - Date.parse(envelope.issuedAt) > maxAgeMs) {
      throw new ControlError("CONTROL_UNAUTHENTICATED");
    }
    const expected = createHmac("sha256", credential.secret).update(signedBytes(body)).digest();
    if (!timingSafeEqual(Buffer.from(mac, "hex"), expected)) throw new ControlError("CONTROL_UNAUTHENTICATED");
    const command = envelope.command;
    if ((command.method === "recover" || command.method === "status") && credential.channel !== "operator") {
      throw new ControlError("CONTROL_FORBIDDEN");
    }
    if ((command.method === "submit" || command.method === "recover") &&
        command.input.installationId !== envelope.installationId) throw new ControlError("CONTROL_FORBIDDEN");
    return new AuthenticatedControlCommand(envelope, credential.channel);
  }
}
