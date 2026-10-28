import { z } from "zod";
import { endpointRegistry, endpoints, IdSchema, resultSchema } from "@quire/contracts";
import type { Endpoint, Id, Lane, MutationAdmission } from "@quire/contracts";
import { ServiceError } from "./errors";

export type RequestContext = {
  readonly request: Request; readonly requestId: Id; readonly responseHeaders: Headers;
};
type Handler<I extends z.ZodType, O extends z.ZodType> = (
  input: z.output<I>, context: RequestContext,
) => z.input<O> | Promise<z.input<O>>;
type Registered = {
  readonly endpoint: Endpoint; readonly invoke: (context: RequestContext, params: Readonly<Record<string, string>>) => Promise<Response>;
};
function matchPath(pattern: string, pathname: string): Readonly<Record<string, string>> | null {
  const names: string[] = [];
  const expression = pattern.split("/").map((part) => {
    if (part === "*") { names.push("wildcard"); return "(.*)"; }
    if (part.startsWith(":")) {
      const suffix = part.endsWith(".git") ? ".git" : "";
      names.push(part.slice(1, suffix ? -4 : undefined));
      return suffix ? "([^/]+)\\.git" : "([^/]+)";
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  const matched = new RegExp(`^${expression}/?$`).exec(pathname);
  if (!matched) return null;
  return Object.fromEntries(names.map((name, index) => {
    const value = matched[index + 1];
    if (value === undefined) throw new ServiceError("INVALID_PATH", 400, "Missing path segment");
    try { return [name, decodeURIComponent(value)]; }
    catch (error) {
      if (error instanceof URIError) throw new ServiceError("INVALID_PATH", 400, "Invalid path encoding");
      throw error;
    }
  }));
}
function routePriority(route: Endpoint): number {
  return route.path.split("/").filter((part) => !part.startsWith(":") && part !== "*").length;
}
async function readBody(request: Request): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  if (!request.body) return {};
  const mime = request.headers.get("content-type") ?? "";
  if (mime.includes("multipart/form-data") || mime.includes("application/x-www-form-urlencoded")) return request.formData();
  if (mime.includes("application/json")) {
    try { return await request.json(); }
    catch (error) {
      if (error instanceof SyntaxError) throw new ServiceError("INVALID_JSON", 400, "Invalid JSON body");
      throw error;
    }
  }
  return new Uint8Array(await request.arrayBuffer());
}
export class RouteRegistry {
  private readonly handlers = new Map<Endpoint, Registered>();
  private readonly routes: readonly Endpoint[];
  constructor(routes: readonly Endpoint[] = endpointRegistry, private readonly admission?: MutationAdmission) {
    this.routes = [...routes].sort((a, b) => routePriority(b) - routePriority(a));
  }
  forLane(lane: Lane) {
    return {
      register: <I extends z.ZodType, O extends z.ZodType>(route: Endpoint<I, O>, handler: Handler<I, O>): void => {
        this.assertRegistration(route, lane);
        this.handlers.set(route, { endpoint: route, invoke: async (context, params) => {
          const { request } = context;
          if (route.idempotent && !request.headers.get("idempotency-key")) {
            throw new ServiceError("IDEMPOTENCY_KEY_REQUIRED", 400, "Idempotency-Key required");
          }
          if (route.ifMatch && !request.headers.get("if-match")) {
            throw new ServiceError("IF_MATCH_REQUIRED", 428, "If-Match required");
          }
          const input = route.input.parse({
            params, query: Object.fromEntries(new URL(request.url).searchParams),
            body: await readBody(request), headers: Object.fromEntries(request.headers),
          });
          const output = route.output.safeParse(await handler(input, context));
          if (!output.success) throw new ServiceError("INVALID_RESPONSE", 500, "Service returned an invalid response");
          if (output.data instanceof Uint8Array) {
            const headers = context.responseHeaders;
            if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");
            if (!headers.has("etag")) headers.set("etag", `"${new Bun.CryptoHasher("sha256").update(output.data).digest("hex")}"`);
            if (!headers.has("content-disposition")) headers.set("content-disposition", "attachment");
            return new Response(new Uint8Array(output.data), { status: route.successStatus, headers });
          }
          return Response.json({ data: output.data, requestId: context.requestId }, {
            status: route.successStatus, headers: context.responseHeaders,
          });
        } });
      },
      registerTransport: (route: Endpoint, handler: (context: RequestContext) => Promise<Response> | Response): void => {
        this.assertRegistration(route, lane);
        this.handlers.set(route, { endpoint: route, invoke: async (context) => handler(context) });
      },
    };
  }
  private assertRegistration(route: Endpoint, lane: Lane): void {
    if (route.lane !== lane || !this.routes.includes(route)) {
      throw new ServiceError("INVALID_REGISTRATION", 500, `${lane} does not own ${route.method} ${route.path}`);
    }
    if (this.handlers.has(route)) throw new ServiceError("DUPLICATE_ROUTE", 500, route.path);
  }
  async fetch(request: Request): Promise<Response> {
    const requestId = IdSchema.parse(crypto.randomUUID());
    const responseHeaders = new Headers({ "x-request-id": requestId, "cache-control": "no-store" });
    try {
      const pathname = new URL(request.url).pathname;
      for (const route of this.routes) {
        if (route.method !== request.method) continue;
        const params = matchPath(route.path, pathname);
        if (!params) continue;
        const handler = this.handlers.get(route);
        if (!handler) throw new ServiceError("NOT_IMPLEMENTED", 501, `${route.method} ${route.path} is not registered`);
        const invoke = () => handler.invoke({ request, requestId, responseHeaders }, params);
        // Backup owns exclusive admission itself. SSE outlives its HTTP response;
        // its replay/delivery SQL takes admission at the storage boundary.
        return await (this.admission && route !== endpoints.backupCreate && route !== endpoints.events
          ? this.admission.writer(invoke) : invoke());
      }
      throw new ServiceError("NOT_FOUND", 404, "Route not found");
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json({ error: { code: "INVALID_INPUT", message: "Request does not match its contract", details: { issues: error.issues } }, requestId }, { status: 400, headers: responseHeaders });
      }
      if (error instanceof ServiceError) {
        if (error.status >= 500 && error.status !== 501) console.error("request.failed", { requestId, code: error.code });
        return Response.json({ error: { code: error.code, message: error.message,
          ...(error.details ? { details: error.details } : {}) }, requestId }, { status: error.status, headers: responseHeaders });
      }
      console.error("request.failed", { requestId, error: error instanceof Error ? error.stack : String(error) });
      return Response.json(resultSchema(z.never()).parse({ error: { code: "INTERNAL_ERROR", message: "Internal server error" }, requestId }), { status: 500, headers: responseHeaders });
    }
  }
}
