import { z } from "zod";
import { routesFor, none, noBody, version, key } from "./route-builders";
import { IdSchema, CountSchema } from "./primitives";

const r = routesFor("A");
const params = z.strictObject({ o: IdSchema });
export const samlAdministrationEndpoints = {
  samlLinks: r("GET", "/api/organizations/:o/saml-links", {
    params, query: none, body: noBody,
    output: z.strictObject({
      configured: z.boolean(), version: CountSchema, snapshot: z.string(),
      items: z.array(z.strictObject({
        userId: IdSchema, name: z.string(), email: z.string(),
        linked: z.boolean(), unproven: z.boolean(), unlinkBlocked: z.string().nullable(),
      })),
    }),
  }),
  samlLinksAction: r("POST", "/api/organizations/:o/saml-links", {
    params, query: none,
    body: z.strictObject({
      ...version, snapshot: z.string(),
      action: z.enum(["remind", "unlink", "unlink-all"]), userId: IdSchema.optional(),
    }),
    output: z.strictObject({ version: CountSchema, affected: CountSchema, queued: CountSchema, signedOut: z.boolean() }),
    ...key,
  }),
} as const;
