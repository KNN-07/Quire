import { afterAll, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import { readZip } from "../../../services/core/base";
import { csv } from "../../../services/accounts/governance/reports";
import { register as tasks } from "../../../services/operations/tasks";
import { governanceFixture, data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

const header = ["sequence", "at", "actorId", "organizationId", "event", "targetId", "details"];
const metadata = z.object({
  format: z.literal("zip"), mime: z.literal("application/zip"), filename: z.literal("audit.zip"),
  rows: z.number(), files: z.number(), operatorOnly: z.boolean(),
});
const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rejects(stat(root), { code: "ENOENT" });
  console.info("AUDIT_ZIP_NATIVE_CLEANED", { roots, absent: roots.length });
});

for (const count of [0, 100, 101]) {
  test(`native organization audit ZIP preserves ${count} ordered entries in 100-entry CSV pages`, async () => {
    await using app = await governanceFixture({ core: true });
    roots.push(app.runtime.config.dataDir);
    tasks({ ...app.runtime, routes: app.runtime.routes.forLane("O") });
    const admin = await app.login();
    const expected: string[][] = [];
    for (let index = 0; index < count; index++) {
      const id = crypto.randomUUID();
      const event = index === 0 ? " \t=SUM(1,2)" : index === 1 ? 'Lab,"quoted"\r\nline' : "audit.fixture";
      const details = { token: "never-export-this", visible: 'Unicode café,"quoted"\nline' };
      await app.runtime.db.run("INSERT INTO audit_entries(id,at,actor_id,organization_id,event,target_id,details_json) VALUES(?,?,?,?,?,?,?)",
        [id, app.runtime.clock.now(), ids.kien, ids.team, event, id, JSON.stringify(details)]);
      const row = z.object({ seq: z.number() }).parse(await app.runtime.db.get("SELECT seq FROM audit_entries WHERE id=?", [id]));
      expected.push([String(row.seq), app.runtime.clock.now(), ids.kien, ids.team, event, id,
        JSON.stringify({ ...details, token: "[redacted]" })]);
    }
    // A foreign entry must never fill an empty page or leak into later pages.
    await app.runtime.db.run("INSERT INTO audit_entries(id,at,organization_id,event,target_id,details_json) VALUES(?,?,?,?,?,?)",
      [crypto.randomUUID(), app.runtime.clock.now(), ids.institution, "foreign", ids.institution, '{"secret":"foreign-secret"}']);
    const key = crypto.randomUUID();
    const operation = await data(await admin.write(`/api/organizations/${ids.team}/audit/export`, {}, { key }), OperationSchema);
    const result = metadata.parse(operation.result);
    expect(result.rows).toBe(count);
    expect(result.files).toBe(Math.max(1, Math.ceil(count / 100)));
    expect(result.operatorOnly).toBe(false);
    const download = await admin.get(`/api/operations/${operation.id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zip");
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="audit.zip"');
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
    const files = readZip(bytes);
    expect(files.map(file => file.path)).toEqual(
      Array.from({ length: result.files }, (_, index) => `audit-${String(index + 1).padStart(4, "0")}.csv`));
    for (const [index, file] of files.entries()) {
      // Byte equality proves headers, escaping, redaction, order, no omissions and no duplicates.
      expect(file.bytes).toEqual(csv([header, ...expected.slice(index * 100, (index + 1) * 100)]));
      expect(new TextDecoder().decode(file.bytes)).not.toContain("never-export-this");
      expect(new TextDecoder().decode(file.bytes)).not.toContain("foreign-secret");
    }
    const replay = await data(await admin.write(`/api/organizations/${ids.team}/audit/export`, {}, { key }), OperationSchema);
    expect(replay).toEqual(operation);
    expect((await admin.get(`/api/operations/${operation.id}`)).status).toBe(200);
    const outsider = await app.login("sam@quire.local");
    const operator = await app.login("operator@quire.local");
    for (const actor of [outsider, operator]) {
      expect((await actor.get(`/api/operations/${operation.id}/download`)).status).toBe(404);
      expect((await actor.get(`/api/operations/${operation.id}`)).status).toBe(404);
    }
    expect((await app.request(`/api/operations/${operation.id}/download`)).status).toBe(404);
    expect((await outsider.write(`/api/organizations/${ids.team}/audit/export`)).status).toBe(403);
    expect((await admin.write(`/api/organizations/${ids.institution}/audit/export`)).status).toBe(403);
    expect((await app.request(`/api/organizations/${ids.team}/audit/export`, {
      method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}",
    })).status).toBe(401);
    expect((await app.request(`/api/organizations/${ids.team}/audit/export`, {
      method: "POST", headers: { cookie: admin.headers.cookie, "idempotency-key": crypto.randomUUID() }, body: "{}",
    })).status).toBe(403);
  });
}

test("native operator export retains filters and denies nonoperators and demoted owners", async () => {
  await using app = await governanceFixture({ core: true });
  roots.push(app.runtime.config.dataDir);
  tasks({ ...app.runtime, routes: app.runtime.routes.forLane("O") });
  const operator = await app.login("operator@quire.local");
  const admin = await app.login();
  for (const [organization, at] of [[ids.team, "2026-10-26T11:00:00.000Z"], [ids.institution, "2026-10-26T12:00:00.000Z"]] as const) {
    await app.runtime.db.run("INSERT INTO audit_entries(id,at,organization_id,event,target_id,details_json) VALUES(?,?,?,?,?,?)",
      [crypto.randomUUID(), at, organization, "audit.fixture", organization, '{"credential":"operator-secret"}']);
  }
  const operation = await data(await operator.write("/api/admin/audit/export",
    { event: "audit.fixture", from: "2026-10-26T12:00:00.000Z", to: "2026-10-26T12:00:00.000Z" }), OperationSchema);
  expect(metadata.parse(operation.result)).toMatchObject({ rows: 1, files: 1, operatorOnly: true });
  const download = await operator.get(`/api/operations/${operation.id}/download`);
  expect(download.status).toBe(200);
  const file = readZip(new Uint8Array(await download.arrayBuffer()))[0];
  const text = new TextDecoder().decode(file?.bytes);
  expect(text).toContain(ids.institution);
  expect(text).not.toContain(ids.team);
  expect(text).toContain("[redacted]");
  expect(text).not.toContain("operator-secret");
  expect((await admin.write("/api/admin/audit/export")).status).toBe(403);
  expect((await admin.get(`/api/operations/${operation.id}/download`)).status).toBe(404);
  expect((await operator.write("/api/admin/audit/export", { from: "2026-10-27T00:00:00.000Z", to: "2026-10-26T00:00:00.000Z" })).status).toBe(400);
  await app.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [operator.user.id]);
  expect((await operator.get(`/api/operations/${operation.id}/download`)).status).toBe(403);
  expect((await operator.get(`/api/operations/${operation.id}`)).status).toBe(403);
});
