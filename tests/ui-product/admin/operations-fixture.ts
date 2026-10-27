import { zipSync, strToU8 } from "fflate";
import { endpoints, IdSchema, InstantSchema, OperationSummarySchema } from "@quire/contracts";
import type { OperationSummary } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";

export function operationsFixture() {
  const bytes = zipSync({ "fixture.json": strToU8(JSON.stringify({ fixture: true })) });
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const operations = new Map<string, OperationSummary>();
  const reply = (data: unknown) => Response.json({ data, requestId: fixtureIds.operator });
  const view = (summary: OperationSummary) => {
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...operation } = summary;
    return operation;
  };
  return (request: Request, url: URL, body: unknown): Response | null => {
    if (url.pathname === "/api/operations" && request.method === "GET") {
      endpoints.operationsList.input.parse({ params: {}, query: Object.fromEntries(url.searchParams) });
      return reply({ items: [...operations.values()], nextCursor: null });
    }
    if (url.pathname === "/api/admin/diagnostics") {
      endpoints.diagnosticsCreate.input.parse({ params: {}, query: {}, body });
      const operation = OperationSummarySchema.parse({
        id: crypto.randomUUID(), kind: "diagnostics", status: "queued", progress: 0, result: null, errorCode: null,
        createdAt: "2026-10-26T13:00:00Z", updatedAt: "2026-10-26T13:00:00Z",
      });
      operations.set(operation.id, operation);
      return reply(view(operation));
    }
    if (url.pathname === "/__fixture/complete-operation") {
      const id = IdSchema.parse(typeof body === "object" && body !== null && "id" in body ? body.id : null);
      const operation = operations.get(id);
      if (!operation) return new Response(null, { status: 404 });
      operations.set(id, { ...operation, status: "succeeded", progress: 1,
        result: { blob: digest, projectIds: [], operatorOnly: true },
        updatedAt: InstantSchema.parse("2026-10-26T13:01:00Z") });
      return Response.json({ ok: true });
    }
    const id = url.pathname.match(/^\/api\/operations\/([^/]+)/)?.[1];
    if (!id) return null;
    const operation = operations.get(id);
    if (!operation) return Response.json({ error: { code: "NOT_FOUND", message: "Fixture operation not found" }, requestId: fixtureIds.operator }, { status: 404 });
    if (url.pathname.endsWith("/download")) {
      if (operation.status !== "succeeded") return new Response(null, { status: 409 });
      return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/zip",
        "content-disposition": 'attachment; filename="quire-diagnostics.zip"', "x-request-id": fixtureIds.operator } });
    }
    return reply(view(operation));
  };
}
