import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal } from "@quire/runtime";
import type { Id, Transaction } from "@quire/contracts";

export async function operator(context: ModuleContext, request: Request): Promise<Principal> {
  const identity = context.services.get("identity");
  const principal = await identity.require(request);
  if (request.method !== "GET") await identity.verifyMutation(request, principal);
  if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator access required");
  return principal;
}

/** Recheck inside the mutation transaction, including on an idempotent replay. */
export async function currentOperator(tx: Transaction, actorId: Id): Promise<void> {
  const row = z.object({ operator: z.number(), suspended: z.number(), deleted_at: z.string().nullable() })
    .nullable().parse(await tx.get("SELECT operator,suspended,deleted_at FROM users WHERE id=?", [actorId]));
  if (!row || row.operator !== 1 || row.suspended !== 0 || row.deleted_at !== null) {
    throw new ServiceError("FORBIDDEN", 403, "Current operator access required");
  }
}
