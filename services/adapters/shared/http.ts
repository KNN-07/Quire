import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import { resolveTarget } from "./network-policy";
import type { HttpPolicy, ResolvedAddress } from "./network-policy";
import { abortable } from "./cancellation";

export type HttpRequest = {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
};
export type HttpResponse = {
  readonly status: number; readonly headers: Headers; readonly bytes: Uint8Array;
};
type PinnedRequest = {
  readonly url: URL; readonly address: ResolvedAddress; readonly input: HttpRequest;
  readonly signal: AbortSignal; readonly maxBytes: number;
};
function requestPinned(input: PinnedRequest): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const headers = new Headers(input.input.headers);
    headers.set("host", input.url.host);
    headers.set("accept-encoding", "identity");
    if (input.input.body !== undefined) {
      headers.set("content-length", String(Buffer.byteLength(input.input.body)));
    }
    const send = input.url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send({
      hostname: input.address.address, family: input.address.family,
      port: input.url.port || (input.url.protocol === "https:" ? 443 : 80),
      servername: input.url.hostname, path: input.url.pathname + input.url.search,
      method: input.input.method ?? "GET", headers: Object.fromEntries(headers),
      agent: false,
    }, (response) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      response.on("error", (error) => {
        input.signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > input.maxBytes) {
          response.destroy(new ServiceError("EGRESS_TOO_LARGE", 413, "Provider response exceeds byte limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        input.signal.removeEventListener("abort", onAbort);
        const resultHeaders = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined) resultHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        resolve({ status: response.statusCode ?? 502, headers: resultHeaders, bytes: Buffer.concat(chunks) });
      });
    });
    const onAbort = () => {
      reject(new ServiceError("EGRESS_TIMEOUT", 502, "Provider request canceled or timed out"));
      request.destroy();
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
    request.on("error", (error) => {
      input.signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    if (input.signal.aborted) { onAbort(); return; }
    request.end(input.input.body);
  });
}
export class SafeHttpClient {
  constructor(private readonly policy: HttpPolicy = {}) {}
  private requireTls(url: URL): void {
    if (url.protocol !== "https:" && !this.policy.fixtureOrigins?.includes(url.origin)) {
      throw new ServiceError("EGRESS_TLS_REQUIRED", 403, "Credentials and provider mutations require HTTPS");
    }
  }
  async validate(url: string, credentials = false): Promise<void> {
    const target = new URL(z.url().parse(url));
    if (credentials) this.requireTls(target);
    await abortable(() => resolveTarget(target, this.policy),
      AbortSignal.timeout(this.policy.timeoutMs ?? 15_000));
  }
  async request(target: string, input: HttpRequest = {}): Promise<HttpResponse> {
    const deadline = AbortSignal.timeout(this.policy.timeoutMs ?? 15_000);
    const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    let url = new URL(z.url().parse(target));
    const maxBytes = Math.min(input.maxBytes ?? this.policy.maxBytes ?? 8 * 1024 * 1024,
      this.policy.maxBytes ?? 8 * 1024 * 1024);
    if (input.body !== undefined && Buffer.byteLength(input.body) > (this.policy.maxBytes ?? 8 * 1024 * 1024)) {
      throw new ServiceError("EGRESS_TOO_LARGE", 413, "Provider request exceeds byte limit");
    }
    try {
      for (let redirects = 0; ; redirects++) {
        signal.throwIfAborted();
        if (input.body !== undefined || Object.keys(input.headers ?? {}).length > 0 ||
          (input.method ?? "GET") !== "GET") this.requireTls(url);
        const address = await abortable(() => resolveTarget(url, this.policy), signal);
        signal.throwIfAborted();
        const response = await requestPinned({ url, address, input, signal, maxBytes });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get("location");
        if (!location || redirects >= (this.policy.maxRedirects ?? 4)) {
          throw new ServiceError("EGRESS_REDIRECT_LIMIT", 502, "Provider redirect is missing or exceeds limit");
        }
        const next = new URL(location, url);
        if ((input.method ?? "GET") !== "GET" || input.body !== undefined ||
          (next.origin !== url.origin && Object.keys(input.headers ?? {}).length > 0) ||
          (url.protocol === "https:" && next.protocol !== "https:")) {
          throw new ServiceError("EGRESS_REDIRECT_DENIED", 403, "Unsafe method, credential or TLS redirect");
        }
        url = next;
      }
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (error instanceof Error) {
        throw new ServiceError(signal.aborted ? "EGRESS_TIMEOUT" : "EGRESS_FAILED", 502,
          signal.aborted ? "Provider request canceled or timed out" : "Provider transport failed");
      }
      throw error;
    }
  }
  async json<T extends z.ZodType>(url: string, schema: T, input: HttpRequest = {}): Promise<z.output<T>> {
    const response = await this.request(url, input);
    if (response.status < 200 || response.status >= 300) {
      throw new ServiceError("PROVIDER_HTTP_ERROR", 502, `Provider returned HTTP ${response.status}`);
    }
    try { return schema.parse(JSON.parse(new TextDecoder().decode(response.bytes))); }
    catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        throw new ServiceError("PROVIDER_RESPONSE_INVALID", 502, "Provider response does not match its contract");
      }
      throw error;
    }
  }
}
export type { HttpPolicy, DnsResolver } from "./network-policy";
