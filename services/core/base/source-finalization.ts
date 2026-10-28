import { z } from "zod";
import { EventPayloadSchemas, IdSchema } from "@quire/contracts";
import { sourceReceipt, saveReceipt } from "./receipts";
import type { TransactionContext } from "./receipts";
import { fail } from "./store";

/** Trusted domain DML, durably replayed with the source, never an HTTP input. */
export const sourceFinalization = z.object({
  statements: z.array(z.object({
    sqlite: z.string(), postgres: z.string(),
    parameters: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    changes: z.number().int().nonnegative(),
  })),
  receipts: z.array(sourceReceipt),
  events: z.array(z.object({
    topic: z.enum(["review.changed", "history.created", "notification.created"]),
    aggregateId: IdSchema, payload: EventPayloadSchemas["review.changed"],
  })),
});
export type SourceFinalization = z.infer<typeof sourceFinalization>;

export async function applyFinalization(context: TransactionContext, input: SourceFinalization): Promise<void> {
  for (const statement of input.statements) {
    const result = await context.db.run(statement[context.db.dialect], statement.parameters);
    if (result.changes !== statement.changes) fail("SOURCE_FINALIZATION_CONFLICT", 409, "Dependent source state changed");
  }
  for (const receipt of input.receipts) await saveReceipt(context, receipt);
}
