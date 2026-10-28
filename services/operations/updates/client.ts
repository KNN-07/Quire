import { z } from "zod";
import { IdSchema, InstantSchema, OperationSchema, ReleaseSchema } from "@quire/contracts";
import type { Clock } from "@quire/contracts";
import {
  ControlError, ReservedUpdateCommandSchema, UpdateOperationQuerySchema,
} from "../installation/model";
import type { UpdateClient } from "../installation/model";
import { signControlCommand } from "../installation/protocol";
import type { ControlCommand, ControlCredential, ControlEnvelope } from "../installation/protocol";

export type { UpdateClient, ReservedUpdateCommand, UpdateOperationRow, UpdateOperationQuery } from "../installation/model";

const OperationRow = z.strictObject({
  actorId: IdSchema, operation: OperationSchema, createdAt: InstantSchema, updatedAt: InstantSchema,
});
export interface UpdateTransport {
  /** Host-owned authenticated private socket; returns an unwrapped command result. */
  send(envelope: ControlEnvelope): Promise<unknown>;
}

/** Signing alone does not provision a socket or validate host capabilities. */
export function createUpdateClient(credential: ControlCredential, clock: Clock, transport: UpdateTransport): UpdateClient {
  if (credential.channel !== "api") throw new ControlError("CONTROL_FORBIDDEN");
  function send(command: ControlCommand): Promise<unknown> {
    return transport.send(signControlCommand({
      protocolVersion: 1, installationId: credential.installationId, credentialId: credential.id,
      requestId: IdSchema.parse(crypto.randomUUID()), issuedAt: clock.now(), command,
    }, credential));
  }
  return {
    releases: async () => z.array(ReleaseSchema).readonly().parse(await send({ method: "releases", input: {} })),
    create: async request => OperationSchema.parse(await send({ method: "submit", input: ReservedUpdateCommandSchema.parse(request) })),
    get: async id => OperationRow.nullable().parse(await send({ method: "get", input: { id: IdSchema.parse(id) } })),
    list: async query => z.array(OperationRow).readonly().parse(await send({ method: "list", input: UpdateOperationQuerySchema.parse(query) })),
  };
}
