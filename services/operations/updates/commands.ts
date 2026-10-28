import { z } from "zod";
import { DigestSchema, IdSchema } from "@quire/contracts";
import type { Id, Transaction, UnitOfWork } from "@quire/contracts";
import { ReservedUpdateCommandSchema } from "../installation/model";
import type { ReservedUpdateCommand } from "../installation/model";
import { requestDigest } from "../installation/protocol";
import { UpdateError } from "./model";

const Reservation = z.object({
  actor_id: IdSchema, request_key: z.string(), operation_id: IdSchema, request_digest: DigestSchema,
});

/** Only command identity is retained in application SQL, never execution state. */
export async function reserveCommand(tx: Transaction, command: ReservedUpdateCommand): Promise<ReservedUpdateCommand> {
  await tx.lock(`o-update-key:${command.actorId}:${command.key}`);
  const prior = Reservation.nullable().parse(await tx.get(
    "SELECT * FROM o_update_command_keys WHERE actor_id=? AND request_key=?", [command.actorId, command.key],
  ));
  if (prior !== null) {
    if (prior.request_digest !== command.requestDigest) throw new UpdateError("IDEMPOTENCY_CONFLICT");
    return ReservedUpdateCommandSchema.parse({ ...command, operationId: prior.operation_id });
  }
  if (await tx.get("SELECT id FROM operations WHERE (actor_id=? AND idempotency_key=?) OR id=?",
    [command.actorId, command.key, command.operationId])) throw new UpdateError("IDEMPOTENCY_CONFLICT");
  await tx.run(`INSERT INTO o_update_command_keys(actor_id,request_key,operation_id,request_digest)
    VALUES(?,?,?,?)`, [command.actorId, command.key, command.operationId, command.requestDigest]);
  return command;
}

export function reserveUpdateCommand(
  uow: UnitOfWork, installationId: string, actorId: Id, key: string, request: ReservedUpdateCommand["request"],
): Promise<ReservedUpdateCommand> {
  const command = ReservedUpdateCommandSchema.parse({
    installationId, operationId: crypto.randomUUID(), actorId, key, request, requestDigest: requestDigest(request),
  });
  return uow.run(tx => reserveCommand(tx, command));
}

/** Restore reconciliation must finish before the host reopens ordinary roles. */
export async function reconcileCommandKeys(uow: UnitOfWork, commands: readonly ReservedUpdateCommand[]): Promise<void> {
  await uow.run(async tx => {
    for (const command of [...commands].sort((a, b) => `${a.actorId}:${a.key}`.localeCompare(`${b.actorId}:${b.key}`))) {
      const parsed = ReservedUpdateCommandSchema.parse(command);
      if (requestDigest(parsed.request) !== parsed.requestDigest) throw new UpdateError("IDEMPOTENCY_CONFLICT");
      const reserved = await reserveCommand(tx, parsed);
      if (reserved.operationId !== parsed.operationId) throw new UpdateError("IDEMPOTENCY_CONFLICT");
    }
  });
}
