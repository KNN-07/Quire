import { z } from "zod";
import type { OAuthConfiguration, ProviderSettings } from "../shared";

const RelativePathSchema = z.string().min(1).refine(
  (value) => !value.startsWith("/") && !value.includes("..") && !value.includes("?") && !value.includes("#"),
  "Publisher contract paths must be relative and cannot contain traversal, query, or fragment components",
);
const FieldNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);
const OAuthSchema = z.strictObject({
  authorizationPath: RelativePathSchema,
  tokenPath: RelativePathSchema,
  revokePath: RelativePathSchema.optional(),
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1).readonly(),
  tokenAuthentication: z.enum(["body", "basic", "none"]),
}).readonly();
const CommonShape = {
  version: z.literal(1),
  credentialTestPath: RelativePathSchema,
  oauth: OAuthSchema,
} as const;
const ManualContractSchema = z.strictObject({
  ...CommonShape,
  mode: z.literal("manual"),
}).readonly();
const DirectContractSchema = z.strictObject({
  ...CommonShape,
  mode: z.literal("direct"),
  submitPath: RelativePathSchema,
  statusPath: RelativePathSchema.refine(
    (value) => value.split("{submissionId}").length === 2,
    "Publisher status path must contain one {submissionId} placeholder",
  ),
  responseFields: z.strictObject({
    submissionId: FieldNameSchema,
    status: FieldNameSchema,
    receipt: FieldNameSchema,
  }).readonly(),
}).readonly();
export const PublisherContractSchema = z.discriminatedUnion("mode", [
  ManualContractSchema,
  DirectContractSchema,
]).readonly();
export type PublisherContract = z.infer<typeof PublisherContractSchema>;
export type DirectPublisherContract = z.infer<typeof DirectContractSchema>;

function decodeContract(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export function publisherRequirements(settings: ProviderSettings): readonly string[] {
  const missing: string[] = [];
  if (!settings.baseUrl) missing.push("publisher destination API base URL");
  if (!settings.secret) missing.push("publisher OAuth client secret");
  if (!settings.model) {
    missing.push("publisher destination contract mapping in model JSON");
    return missing;
  }
  const parsed = PublisherContractSchema.safeParse(decodeContract(settings.model));
  if (!parsed.success) missing.push("valid publisher destination contract mapping in model JSON");
  return missing;
}

export function parsePublisherContract(settings: ProviderSettings): PublisherContract {
  return PublisherContractSchema.parse(decodeContract(settings.model ?? ""));
}

export function publisherOAuth(settings: ProviderSettings): OAuthConfiguration {
  const contract = parsePublisherContract(settings);
  return {
    authorizationUrl: endpoint(settings.baseUrl, contract.oauth.authorizationPath),
    tokenUrl: endpoint(settings.baseUrl, contract.oauth.tokenPath),
    ...(contract.oauth.revokePath
      ? { revokeUrl: endpoint(settings.baseUrl, contract.oauth.revokePath) }
      : {}),
    clientId: contract.oauth.clientId,
    ...(settings.secret ? { clientSecret: settings.secret } : {}),
    scopes: contract.oauth.scopes,
    tokenAuthentication: contract.oauth.tokenAuthentication,
  };
}

export function endpoint(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
}
