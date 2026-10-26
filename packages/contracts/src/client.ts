import ky from "ky";
import { z } from "zod";
import { IdSchema, ErrorResultSchema, assertNever } from "./primitives";
import type { Result } from "./primitives";
import type { Endpoint } from "./endpoint";
import { parseResourceVersionTag } from "./version-headers";

export class ClientContractError extends Error {
  constructor(readonly reason: string) { super(reason); this.name = "ClientContractError"; }
}
export type ClientResponse<T> = {
  readonly result: Result<T>;
  readonly metadata: { readonly etag: string | null; readonly expectedVersion: number | null };
};
type WireInput = {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown; readonly headers?: Readonly<Record<string, string | undefined>>;
};
function targetUrl(baseUrl: string, route: Endpoint, parsed: WireInput): URL {
  let path = route.path;
  for (const [name, value] of Object.entries(parsed.params)) {
    path = name === "wildcard" ? path.replace("*", value) :
      path.replace(`:${name}`, encodeURIComponent(value));
  }
  const url = new URL(baseUrl + path, globalThis.location?.origin ?? "http://localhost");
  for (const [name, value] of Object.entries(parsed.query)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  return url;
}
export function createClient(baseUrl = "", options: { readonly csrfToken?: () => string | null } = {}) {
  const http = ky.create({ timeout: 30_000, retry: 0, throwHttpErrors: false, credentials: "same-origin" });
  async function send<I extends z.ZodType<WireInput>, O extends z.ZodType>(
      route: Endpoint<I, O>, input: z.input<I>, signal?: AbortSignal,
    ): Promise<ClientResponse<z.output<O>>> {
      const parsed = route.input.parse(input);
      const url = targetUrl(baseUrl, route, parsed);
      const headers = new Headers();
      for (const [name, value] of Object.entries(parsed.headers ?? {})) if (value) headers.set(name, value);
      const csrf = options.csrfToken?.();
      if (csrf) headers.set("x-csrf-token", csrf);
      if (route.idempotent && !headers.has("idempotency-key")) throw new ClientContractError("Idempotency-Key required");
      if (route.ifMatch && !headers.has("if-match")) throw new ClientContractError("If-Match required");
      switch (route.transport) {
        case "sse":
        case "websocket":
          throw new ClientContractError("Use client.url() with the native streaming transport");
        case "json":
        case "bytes":
        case "multipart":
          break;
        default:
          assertNever(route.transport);
      }
      // Multipart schemas normalize fields for server handlers; preserve the original wire form.
      const body = typeof input === "object" && input !== null && "body" in input &&
        input.body instanceof FormData ? input.body : parsed.body;
      const response = await http(url, {
        method: route.method, headers, ...(signal ? { signal } : {}),
        ...(body === undefined ? {} : body instanceof FormData ? { body } :
          body instanceof Uint8Array ? { body: new Uint8Array(body) } : { json: body }),
      });
      const etag = response.headers.get("etag");
      const metadata = { etag, expectedVersion: parseResourceVersionTag(etag) };
      if (response.ok && route.output instanceof z.ZodCustom) {
        return { result: { data: route.output.parse(new Uint8Array(await response.arrayBuffer())),
          requestId: IdSchema.parse(response.headers.get("x-request-id")) }, metadata };
      }
      const envelope = z.union([
        z.strictObject({ data: z.unknown(), requestId: IdSchema }), ErrorResultSchema,
      ]).parse(await response.json());
      if ("error" in envelope) return { result: envelope, metadata };
      return { result: { data: route.output.parse(envelope.data), requestId: envelope.requestId }, metadata };
  }
  return {
    url<I extends z.ZodType<WireInput>>(route: Endpoint<I>, input: z.input<I>): URL {
      return targetUrl(baseUrl, route, route.input.parse(input));
    },
    callWithMetadata: send,
    async call<I extends z.ZodType<WireInput>, O extends z.ZodType>(
      route: Endpoint<I, O>, input: z.input<I>, signal?: AbortSignal,
    ): Promise<Result<z.output<O>>> {
      return (await send(route, input, signal)).result;
    },
  };
}
