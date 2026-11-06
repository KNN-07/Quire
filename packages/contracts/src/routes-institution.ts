import { z } from "zod";
import { routesFor, none, noBody, version } from "./route-builders";
import { IdSchema, InstantSchema, CountSchema } from "./primitives";

const r = routesFor("A");
const params = z.strictObject({ o: IdSchema });
const period = z.number().int().min(1).max(36500).nullable();
const policy = z.strictObject({ reconfirmationDays: period, version: CountSchema });
export const institutionEndpoints = {
  institutionPolicyGet: r("GET", "/api/organizations/:o/institution-policy", {
    params, query: none, body: noBody, output: policy,
  }),
  institutionPolicyPut: r("PUT", "/api/organizations/:o/institution-policy", {
    params, query: none, body: z.strictObject({ reconfirmationDays: period, ...version }), output: policy,
  }),
  institutionEligibility: r("GET", "/api/institutions/:slug/eligibility", {
    params: z.strictObject({ slug: z.string() }), query: none, body: noBody,
    output: z.strictObject({
      eligible: z.boolean(), member: z.boolean(), reconfirmationDays: period,
      checkedAt: InstantSchema.nullable(), expiresAt: InstantSchema.nullable(),
      state: z.enum(["not-enrolled", "current", "expired", "ineligible"]),
    }),
  }),
} as const;
