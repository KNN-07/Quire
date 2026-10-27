import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import ky from "ky";
import { createClient, endpoints, ErrorResultSchema } from "@quire/contracts";
import { createApplication } from "../../../apps/server/src/composition";
import { isolatedData } from "../../fixtures/runtime";

// This is an honest foundation probe, not verification of uncomposed O/A/X handlers.
await using data = await isolatedData();
const application = await createApplication({ config: data.config, modules: [] });
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: application.fetch });
try {
  const client = createClient(server.url.origin);
  const health = await client.call(endpoints.health, { params: {}, query: {}, body: undefined });
  assert.ok("data" in health);
  const statuses = [];
  for (const path of ["/api/admin/overview", "/api/admin/identity", "/api/admin/workers", "/api/admin/backups", "/api/admin/providers/ai"]) {
    const response = await ky.get(new URL(path, server.url), { retry: 0, timeout: 10_000, throwHttpErrors: false });
    const error = ErrorResultSchema.parse(await response.json());
    assert.equal(response.status, 501);
    assert.equal(error.error.code, "NOT_IMPLEMENTED");
    statuses.push({ path, status: response.status, code: error.error.code });
  }
  const result = { runtime: Bun.version, health, admin: statuses, scope: "Actual SQLite foundation HTTP. No service modules composed. Real admin backend verification pending.", cleanup: "Server and SQLite closed; unique data directory removed by async disposal." };
  await writeFile("docs/evidence/p1-ui-admin/backend-smoke.json", JSON.stringify(result, null, 2));
  console.log("PASS: real foundation health; five uncomposed admin reads return 501 NOT_IMPLEMENTED.");
} finally {
  await server.stop(true);
  await application.close();
}
