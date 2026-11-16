import { z } from "zod";

const RelativePathSchema = z.string().min(1).refine(
  value => !value.startsWith("/") && !value.includes(":") && !value.includes("\\")
    && !value.includes("..") && !value.includes("?") && !value.includes("#")
    && !/[\s%]/.test(value) && !value.split("").some(character => character.charCodeAt(0) < 32),
  "Publisher contract paths must be relative without traversal, escapes, query or fragment components",
);
const OAuthSchema = z.strictObject({
  authorizationPath: RelativePathSchema, tokenPath: RelativePathSchema,
  revokePath: RelativePathSchema.optional(), clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1).readonly(),
  tokenAuthentication: z.enum(["body", "basic", "none"]),
}).readonly();
const common = {
  version: z.literal(1), credentialTestPath: RelativePathSchema,
  oauth: OAuthSchema.optional(), authentication: z.literal("bearer").optional(),
  actions: z.strictObject({
    prepare: z.boolean().optional(), submit: z.boolean().optional(), status: z.boolean().optional(),
  }).readonly().optional(),
};
export const PublisherContractSchema = z.discriminatedUnion("mode", [
  z.strictObject({ ...common, mode: z.literal("manual") }).readonly(),
  z.strictObject({
    ...common, mode: z.literal("direct"), submitPath: RelativePathSchema,
    statusPath: RelativePathSchema.refine(value => value.split("{submissionId}").length === 2,
      "Publisher status path must contain one {submissionId} placeholder"),
    responseFields: z.strictObject({
      submissionId: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
      status: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
      receipt: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    }).readonly(),
  }).readonly(),
]).refine(value => (value.authentication === "bearer") !== (value.oauth !== undefined),
  "Specify either bearer authentication or an OAuth contract").readonly();
export type PublisherContract = z.infer<typeof PublisherContractSchema>;
export type DirectPublisherContract = Extract<PublisherContract, { readonly mode: "direct" }>;
