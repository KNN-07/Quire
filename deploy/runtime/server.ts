import { resolve, sep, extname } from "node:path";
import { createApplication } from "../../apps/server/src/composition";
import type { RealtimeSocketData } from "@quire/runtime";

/** The built application loads only its own scripts, styles and workers.
 * WebAssembly compilation is needed by the PDF viewer and the opt-in Python
 * runtime; blob: frames and images carry downloaded PDFs and figures. Module
 * workers take this policy from their own script response, which confines the
 * Python worker to same-origin connections. */
export const contentSecurityPolicy = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'",
  "worker-src 'self' blob:", "frame-src 'self' blob:", "object-src 'none'",
  "base-uri 'self'", "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(publicUrl: string): Readonly<Record<string, string>> {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin",
    ...(new URL(publicUrl).protocol === "https:" ? { "strict-transport-security": "max-age=31536000" } : {}),
  };
}

/** The API, SSE and WebSocket transports retain their original handlers. */
export async function startProductionServer() {
  const root = resolve(process.env["QUIRE_WEB_ROOT"] ?? "dist/web");
  if (!(await Bun.file(resolve(root, "index.html")).exists())) {
    throw new DeploymentError("WEB_BUILD_REQUIRED", root);
  }
  const app = await createApplication();
  await app.start();
  const baseHeaders = securityHeaders(app.runtime.config.publicUrl);
  const server = Bun.serve<RealtimeSocketData>({
    hostname: app.runtime.config.host,
    port: app.runtime.config.port,
    maxRequestBodySize: app.runtime.config.maxRequestBytes,
    websocket: app.websocket,
    async fetch(request, listener) {
      const url = new URL(request.url);
      if (/^\/(?:api|git|events|scim|internal)(?:\/|$)/.test(url.pathname) ||
          request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const response = await app.handle(request, listener);
        // A completed WebSocket upgrade has no response to decorate.
        if (response) for (const [name, value] of Object.entries(baseHeaders)) {
          if (name !== "x-frame-options" && !response.headers.has(name)) response.headers.set(name, value);
        }
        return response;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, { status: 405 });
      }
      let path: string;
      try { path = resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)); }
      catch (error) {
        if (!(error instanceof URIError)) throw error;
        return new Response(null, { status: 400 });
      }
      if (!path.startsWith(root + sep)) return new Response(null, { status: 404 });
      const asset = Bun.file(path);
      const exists = await asset.exists();
      if (!exists && extname(path)) return new Response(null, { status: 404 });
      const file = exists ? asset : Bun.file(resolve(root, "index.html"));
      return new Response(request.method === "HEAD" ? null : file, {
        headers: {
          "content-type": file.type,
          "cache-control": exists && url.pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable" : "no-cache",
          ...baseHeaders,
          "content-security-policy": contentSecurityPolicy,
        },
      });
    },
  });
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      server[Symbol.dispose]();
      server.unref();
      await app.close();
    })();
    return closing;
  };
  return { server, close };
}

export class DeploymentError extends Error {
  constructor(readonly code: string, readonly target: string) {
    super(`${code}: ${target}`);
    this.name = "DeploymentError";
  }
}

if (import.meta.main) {
  const app = await startProductionServer();
  console.info("server.listening", { url: app.server.url.toString() });
  const stop = () => { void app.close().then(() => process.exit(0)); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
