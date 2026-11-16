import { PublisherContractSchema } from "@quire/contracts";
import type { PublisherContract } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { OAuthConfiguration, ProviderSettings } from "../shared";
export { PublisherContractSchema } from "@quire/contracts";
export type { PublisherContract, DirectPublisherContract } from "@quire/contracts";

function decodeContract(value: string): unknown {
  try { return JSON.parse(value); }
  catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
export function publisherRequirements(settings: ProviderSettings): readonly string[] {
  const missing: string[] = [];
  if (!settings.baseUrl) missing.push("publisher destination API base URL");
  const parsed = PublisherContractSchema.safeParse(settings.publisherContract ?? decodeContract(settings.model ?? ""));
  if (!parsed.success) missing.push("valid publisher destination contract mapping in publisherContract or legacy model JSON");
  else if (parsed.data.oauth && parsed.data.oauth.tokenAuthentication !== "none" && !settings.secret) {
    missing.push("publisher OAuth client secret");
  }
  return missing;
}
export function parsePublisherContract(settings: ProviderSettings): PublisherContract {
  return PublisherContractSchema.parse(settings.publisherContract ?? decodeContract(settings.model ?? ""));
}
export function publisherOAuth(settings: ProviderSettings): OAuthConfiguration {
  const oauth = parsePublisherContract(settings).oauth;
  if (!oauth) throw new ServiceError("OAUTH_UNSUPPORTED", 422, "Publisher destination uses bearer credential enrollment");
  return {
    authorizationUrl: endpoint(settings.baseUrl, oauth.authorizationPath),
    tokenUrl: endpoint(settings.baseUrl, oauth.tokenPath),
    ...(oauth.revokePath ? { revokeUrl: endpoint(settings.baseUrl, oauth.revokePath) } : {}),
    clientId: oauth.clientId, ...(settings.secret ? { clientSecret: settings.secret } : {}),
    scopes: oauth.scopes, tokenAuthentication: oauth.tokenAuthentication,
  };
}
export function endpoint(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
}
