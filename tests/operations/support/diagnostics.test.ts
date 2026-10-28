import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { OperationSchema, endpoints } from "@quire/contracts";
import { supportFixture } from "./fixture";

test("exports real redacted diagnostic bytes and reauthorizes downloads when operator access changes", async () => {
  // Given: real native SQL, blob and repository ports with private canaries in distinct storage boundaries.
  await using fixture = await supportFixture();
  const operator = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  const canaries = ["private-name-canary-93842", "private-source-canary-49539", "private-key-canary-15362",
    "private-setting-canary-82543", "private-mail-canary-57862"];
  await fixture.runtime.db.run("UPDATE users SET latex_name=? WHERE id=?", [canaries[0] ?? "", operator.id]);
  await fixture.runtime.db.run("UPDATE document_states SET text=?", [canaries[1] ?? ""]);
  await fixture.runtime.db.run("INSERT INTO operator_settings(key,value_json,updated_at) VALUES(?,?,?)",
    ["support-test", JSON.stringify({ token: canaries[3] }), fixture.runtime.clock.now()]);
  await fixture.runtime.db.run(`INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,created_at)
    VALUES(?,?,?,?,?,?)`, [crypto.randomUUID(), "private-support@example.invalid", canaries[4] ?? "", canaries[4] ?? "",
    crypto.randomUUID(), fixture.runtime.clock.now()]);
  const configured = await fixture.request(endpoints.auditSiem.path, { method: "PUT", headers: {
    ...operator, "if-match": '"v0"',
  }, body: JSON.stringify({ endpoint: "http://127.0.0.1:1/siem", secret: canaries[2], enabled: false, expectedVersion: 0 }) });
  expect(configured.status).toBe(200);
  // When: an operator creates and downloads the real byte artifact, then loses operator authority.
  const create = () => fixture.request(endpoints.diagnosticsCreate.path, { method: "POST",
    headers: { ...operator, "idempotency-key": "diagnostic-canaries" }, body: "{}" });
  const created = await create();
  const operation = z.object({ data: OperationSchema }).parse(await created.json()).data;
  const download = await fixture.request(`/api/operations/${operation.id}/download`, { headers: operator });
  const bytes = new Uint8Array(await download.arrayBuffer());
  const bundle = z.object({ manifest: z.object({ format: z.literal("quire-support-v1"), redacted: z.literal(true),
    contents: z.array(z.string()), omitted: z.array(z.string()) }),
    runtime: z.object({ database: z.object({ state: z.literal("ready") }),
      repository: z.object({ state: z.literal("ready") }) }),
    sandbox: z.object({ state: z.enum(["ready", "degraded"]) }),
    tools: z.record(z.string(), z.object({ state: z.string(), exitCode: z.number().optional() })),
  }).parse(JSON.parse(new TextDecoder().decode(bytes)));
  const replay = z.object({ data: OperationSchema }).parse(await (await create()).json()).data;
  await fixture.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [operator.id]);
  // Then: artifact is actual JSON bytes, contains no private canaries, and replay/download require current rights.
  expect(created.status).toBe(202);
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toBe("application/json");
  expect(bytes.length).toBeGreaterThan(500);
  for (const canary of [...canaries, fixture.path, "private-support@example.invalid"]) {
    expect(new TextDecoder().decode(bytes).includes(canary)).toBe(false);
  }
  expect(bundle.tools["git"]?.exitCode).toBe(0);
  expect(replay.id).toBe(operation.id);
  expect((await create()).status).toBe(403);
  expect((await fixture.request(`/api/operations/${operation.id}/download`, { headers: operator })).status).toBe(403);
  expect((await fixture.request(`/api/operations/${operation.id}/download`, { headers: viewer })).status).toBe(404);
  if (process.env["QUIRE_SUPPORT_EVIDENCE"]) {
    const dir = process.env["QUIRE_SUPPORT_EVIDENCE"];
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "diagnostic-canaries.json"), bytes);
    await writeFile(join(dir, "diagnostic-artifact.json"), JSON.stringify({
      id: operation.id, bytes: bytes.length, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      sandboxState: bundle.sandbox.state, canaryCount: canaries.length + 2,
    }, null, 2));
  }
}, 120000);

test("rejects diagnostic mutations without authenticated operator and CSRF authority", async () => {
  // Given: actual sessions for a viewer and operator.
  await using fixture = await supportFixture();
  const viewer = await fixture.login("alex@quire.local");
  const operator = await fixture.login();
  // When: unauthorized callers try the mutation.
  const create = (headers: Record<string, string>) => fixture.request("/api/admin/diagnostics", {
    method: "POST", headers: { ...headers, "idempotency-key": crypto.randomUUID() }, body: "{}",
  });
  // Then: no probe/artifact operation is started.
  expect((await create({})).status).toBe(401);
  expect((await create(viewer)).status).toBe(403);
  expect((await create({ cookie: operator.cookie })).status).toBe(403);
  expect(await fixture.runtime.db.get("SELECT 1 FROM operations WHERE kind='support-diagnostics'")).toBeNull();
});
