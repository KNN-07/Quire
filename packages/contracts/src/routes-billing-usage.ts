import { z } from "zod";
import { routesFor, none, noBody } from "./route-builders";
import { CountSchema, IdSchema, InstantSchema } from "./primitives";

const r = routesFor("X");
export const billingUsageEndpoints = {
  billingUsageGet: r("GET", "/api/me/billing-usage", {
    params: none, query: z.strictObject({ projectId: IdSchema.optional() }), body: noBody,
    output: z.strictObject({
      day: z.string(), observedAt: InstantSchema, resetsAt: InstantSchema, used: CountSchema, reserved: CountSchema, refunded: CountSchema,
      project: z.strictObject({
        id: IdSchema, name: z.string(), ownerId: IdSchema,
        aiDailyLimit: CountSchema.nullable(), aiUnavailable: z.string().nullable(),
        writableMembers: CountSchema.nullable(), assignedMembers: CountSchema,
        effectiveMembers: CountSchema, selectionRequired: z.boolean(), compileSeconds: CountSchema,
      }).nullable(),
    }),
  }),
} as const;
