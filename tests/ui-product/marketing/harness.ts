import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { endpoints, IdSchema } from "@quire/contracts";
import { defaultPolicy, fixtureIds } from "../../fixtures/foundation";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Wire-level fixtures test UI contract handling, not service-lane persistence.
let mode = "unconfigured";
const inquiries: unknown[] = [];
const api = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const requestId = IdSchema.parse(crypto.randomUUID());
    if (path === "/__fixture") {
      if (request.method === "POST") { mode = await request.text(); inquiries.length = 0; }
      return Response.json({ mode, inquiries });
    }
    if (path === endpoints.billingCatalog.path) return Response.json({
      data: endpoints.billingCatalog.output.parse(mode === "configured" ? { configured: true, plans: [
        { id: "month", name: "Operator monthly", amountMinor: 1234, currency: "USD", period: "month" },
        { id: "year", name: "Operator annual", amountMinor: 9876, currency: "USD", period: "year" },
      ] } : { configured: false, plans: [] }), requestId,
    });
    if (path === endpoints.supportInquiry.path && request.method === "POST") {
      const parsed = endpoints.supportInquiry.input.parse({ params: {}, query: {}, body: await request.json(), headers: { "idempotency-key": request.headers.get("idempotency-key") } });
      if (mode === "accept") {
        inquiries.push(parsed);
        return Response.json({ data: endpoints.supportInquiry.output.parse({ ok: true, version: inquiries.length }), requestId });
      }
      return Response.json({ error: { code: "NOT_IMPLEMENTED", message: "Support service is not registered" }, requestId }, { status: 501 });
    }
    if (path === "/api/institutions/test-lab") return Response.json({ data: endpoints.institutionGet.output.parse({
      id: fixtureIds.institution, slug: "test-lab", name: "Test institution", kind: "institution", domains: ["example.test"], policy: defaultPolicy, version: 0,
    }), requestId });
    if (path === "/api/institutions/test-lab/enroll") {
      endpoints.institutionEnroll.input.parse({ params: { slug: "test-lab" }, query: {}, body: await request.json(), headers: { "idempotency-key": request.headers.get("idempotency-key") } });
      return Response.json({ data: endpoints.institutionEnroll.output.parse({ id: requestId, organizationId: fixtureIds.institution, userId: fixtureIds.kien, role: "member", licensed: false, version: 0 }), requestId });
    }
    if (path.startsWith("/api/institutions/")) return Response.json({ error: { code: "NOT_FOUND", message: "Institution does not exist" }, requestId }, { status: 404 });
    return Response.json({ error: { code: "NOT_IMPLEMENTED", message: "No fixture for this endpoint" }, requestId }, { status: 501 });
  },
});
const reservation = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data(socket) { socket.end(); } } });
const port = reservation.port;
reservation.stop();
const cacheDir = await mkdtemp(join(tmpdir(), "marketing-vite-"));
const vite = await createServer({
  configFile: false, root: process.cwd(), cacheDir, plugins: [react(), {
    name: "marketing-preview",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== "GET" || request.url?.includes(".") || request.url?.startsWith("/@") || request.url?.startsWith("/api") || request.url?.startsWith("/__fixture")) { next(); return; }
        response.setHeader("Content-Type", "text/html");
        void server.transformIndexHtml(request.url ?? "/", `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quire marketing verification</title></head><body><div id="root"></div><script type="module" src="/tests/ui-product/marketing/preview.tsx"></script></body></html>`).then(html => response.end(html)).catch(next);
      });
    },
  }], server: {
    host: "127.0.0.1", port, strictPort: true,
    proxy: { "/api": api.url.origin, "/__fixture": api.url.origin },
  },
});
await vite.listen();
const address = vite.httpServer?.address();
if (address && typeof address === "object") console.log(`MARKETING_READY http://127.0.0.1:${address.port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  void vite.close().then(async () => { await api.stop(true); await rm(cacheDir, { recursive: true, force: true }); process.exit(0); });
});
