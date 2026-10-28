import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import type { Clock } from "@quire/contracts";
import type { HttpRequest, SafeHttpClient } from "../shared";

export type ProviderResponse = {
  readonly endpoint: string; readonly bytes: Uint8Array; readonly headers: Headers;
};
export class ReferenceTransport {
  private readonly blocked = new Map<string, number>();
  constructor(readonly http: SafeHttpClient, readonly clock: Clock) {}
  async get(url: URL, input: HttpRequest = {}): Promise<ProviderResponse> {
    if ((this.blocked.get(url.origin) ?? 0) > Date.parse(this.clock.now())) {
      throw new ServiceError("PROVIDER_RATE_LIMITED", 429, { message: "Provider cooldown has not elapsed",
        details: { retryAt: new Date(this.blocked.get(url.origin) ?? 0).toISOString() } });
    }
    const response = await this.http.request(url.href, input);
    const retry = response.headers.get("retry-after") ?? response.headers.get("backoff");
    if (retry) {
      const seconds = Number(retry);
      const until = Number.isFinite(seconds) ? Date.parse(this.clock.now()) + Math.max(0, seconds) * 1000 : Date.parse(retry);
      if (Number.isFinite(until)) this.blocked.set(url.origin, until);
    }
    switch (response.status) {
      case 401: throw new ServiceError("PROVIDER_AUTH_REQUIRED", 503, "Provider credential is missing, expired or revoked");
      case 403: throw new ServiceError("PROVIDER_ACCESS_DENIED", 403, "Provider grant lacks required library or catalog access");
      case 404: throw new ServiceError("PUBLICATION_NOT_FOUND", 404, "Provider record not found");
      case 429: throw new ServiceError("PROVIDER_RATE_LIMITED", 429, { message: "Provider rate limit", details: { retryAfter: retry } });
      default:
        if (response.status < 200 || response.status >= 300) {
          throw new ServiceError("PROVIDER_HTTP_ERROR", 502, `Provider returned HTTP ${response.status}`);
        }
    }
    return { endpoint: url.href, bytes: response.bytes, headers: response.headers };
  }
  json<T extends z.ZodType>(response: ProviderResponse, schema: T): z.output<T> {
    try { return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.bytes))); }
    catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError || error instanceof TypeError) {
        throw new ServiceError("PROVIDER_RESPONSE_INVALID", 502, "Provider response does not match its documented contract");
      }
      throw error;
    }
  }
}
export function providerUrl(base: string, path: string): URL {
  return new URL(`${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
}
export function nextLink(response: ProviderResponse): URL | null {
  const raw = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(response.headers.get("link") ?? "")?.[1];
  if (!raw) return null;
  const next = new URL(raw, response.endpoint);
  const previous = new URL(response.endpoint);
  if (next.origin !== previous.origin || next.pathname !== previous.pathname || next.username || next.password) {
    throw new ServiceError("PROVIDER_PAGING_INVALID", 502, "Provider pagination changed origin or resource");
  }
  return next;
}
