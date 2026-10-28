import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { unzipSync } from "fflate";
import { DigestSchema, IdSchema, OperationSchema } from "@quire/contracts";
import { ExportSourceSchema } from "../../../services/core/base/operations";
import { reviewFixture, mutation } from "../review/harness";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";

type Fixture = Awaited<ReturnType<typeof reviewFixture>>;
const exportsPath = `/api/projects/${ids.project}/exports`;
const error = z.object({ error: z.object({ code: z.string() }) });
async function window(app: Fixture, headers: Record<string, string>, historyDays: number | null) {
  const current = z.object({ version: z.number() }).parse(await app.runtime.db.get(
    "SELECT version FROM account_project_benefits WHERE scope_kind='deployment'"));
  const response = await app.request("/api/admin/project-benefits/deployment/local", {
    method: "PUT", headers, body: JSON.stringify({ expectedVersion: current.version,
      benefits: { compileSeconds: 12, writableMembers: null, historyDays, trackChanges: true } }),
  });
  expect(response.status).toBe(200);
}
async function exported(app: Fixture, headers: Record<string, string>) {
  const response = await app.request(exportsPath, mutation(headers, { kind: "source" }));
  expect(response.status).toBe(202);
  return z.object({ data: OperationSchema }).parse(await response.json()).data;
}
test("permits unchanged old current source but never treats an explicit historical request as current", async () => {
  // Given: unchanged current source older than the newly finite history window.
  await using app = await reviewFixture();
  const viewer = await app.login("alex@quire.local");
  app.setTime("2026-10-28T12:00:00.000Z");
  const operator = await app.login("operator@quire.local");
  await window(app, operator.headers, 1);
  // When: a Viewer exports and downloads current source, then explicitly requests that old snapshot.
  const operation = await exported(app, viewer.headers);
  const response = await app.request(`/api/operations/${operation.id}/download`, { headers: viewer.headers });
  const historical = await app.request(exportsPath, mutation(viewer.headers, { kind: "source", snapshotId: ids.snapshot }));
  // Then: current-source authority works, while explicit history retains the age boundary.
  expect(response.status).toBe(200);
  expect(unzipSync(new Uint8Array(await response.arrayBuffer()))["main.tex"]?.length).toBeGreaterThan(0);
  expect(historical.status).toBe(403);
  expect(error.parse(await historical.json()).error.code).toBe("HISTORY_WINDOW");
  const provenance = z.object({ sourceSnapshots: z.array(ExportSourceSchema) }).parse(operation.result);
  expect(provenance.sourceSnapshots).toEqual([{ snapshotId: ids.snapshot, scope: { projectId: ids.project, branch: "main" },
    revision: 0, kind: "current" }]);
});
test("reapplies age access to a captured current export after its branch source moves", async () => {
  // Given: an accessible current export whose captured checkpoint is already old.
  await using app = await reviewFixture();
  const owner = await app.login();
  const viewer = await app.login("alex@quire.local");
  app.setTime("2026-10-28T12:00:00.000Z");
  const operator = await app.login("operator@quire.local");
  await window(app, operator.headers, 1);
  const operation = await exported(app, viewer.headers);
  expect((await app.request(`/api/projects/${ids.project}/files`, mutation(owner.headers,
    { scope: { projectId: ids.project, branch: "main" }, path: "moved.txt", kind: "file", text: "New source", expectedVersion: 0 }))).status).toBe(200);
  // When: the Viewer downloads the old captured export after a real source publication.
  const response = await app.request(`/api/operations/${operation.id}/download`, { headers: viewer.headers });
  // Then: the old current-source exception cannot become permanent historical access.
  expect(response.status).toBe(403);
  expect(error.parse(await response.json()).error.code).toBe("HISTORY_WINDOW");
  expect(await app.runtime.db.get("SELECT id FROM operations WHERE id=?", [operation.id])).toEqual({ id: operation.id });
});
test("permits explicitly labeled old history through source-export publication and download", async () => {
  // Given: a real labeled checkpoint, then a finite history downgrade.
  await using app = await reviewFixture();
  const owner = await app.login();
  expect((await app.request(`/api/projects/${ids.project}/history/${ids.snapshot}/labels`,
    mutation(owner.headers, { name: "Preserved checkpoint", expectedVersion: 0 }))).status).toBe(200);
  app.setTime("2026-10-28T12:00:00.000Z");
  const operator = await app.login("operator@quire.local");
  await window(app, operator.headers, 1);
  // When: the old labeled snapshot is explicitly exported and downloaded.
  const response = await app.request(exportsPath, mutation(owner.headers, { kind: "source", snapshotId: ids.snapshot }));
  expect(response.status).toBe(202);
  const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
  const downloaded = await app.request(`/api/operations/${operation.id}/download`, { headers: owner.headers });
  // Then: labels remain a shared exception, not a special timeline-only bypass.
  expect(downloaded.status).toBe(200);
  expect(new Uint8Array(await downloaded.arrayBuffer()).length).toBeGreaterThan(0);
});
test("applies historical and anonymous-read gates independently for old current-source link exports", async () => {
  // Given: a live anonymous Viewer link and an old unchanged current checkpoint.
  await using app = await reviewFixture();
  const owner = await app.login();
  await app.runtime.db.run("UPDATE organizations SET policy_json=?",
    [JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: true })]);
  const linked = await app.request(`/api/projects/${ids.project}/link`, { method: "PUT",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": '"v0"' },
    body: JSON.stringify({ role: "viewer", expectedVersion: 0 }) });
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await linked.json()).data.urlOnce;
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new TypeError("Live share token required");
  const headers = { "x-project-token": token };
  app.setTime("2026-10-28T12:00:00.000Z");
  const operator = await app.login("operator@quire.local");
  await window(app, operator.headers, 1);
  // When: anonymous current and explicit historical exports are requested under the same finite policy.
  const operation = await exported(app, headers);
  const historical = await app.request(exportsPath, mutation(headers, { kind: "source", snapshotId: ids.snapshot }));
  const current = await app.request(`/api/operations/${operation.id}/download`, { headers });
  // Then: current-source access does not bypass either the history distinction or live anonymous policy.
  expect(current.status).toBe(200);
  expect(historical.status).toBe(403);
  await app.runtime.db.run("UPDATE organizations SET policy_json=?",
    [JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: false })]);
  expect((await app.request(`/api/operations/${operation.id}/download`, { headers })).status).toBe(401);
});
for (const historyDays of [1, null]) {
  test(`requires unlimited current history for legacy source-export downloads when window=${historyDays}`, async () => {
    // Given: retained pre-benefit source-export data with no guessed provenance.
    await using app = await reviewFixture();
    const owner = await app.login();
    const operation = await exported(app, owner.headers);
    const legacy = z.object({ blob: DigestSchema, projectIds: z.array(IdSchema) }).parse(operation.result);
    await app.runtime.db.run("UPDATE operations SET result_json=? WHERE id=?", [JSON.stringify(legacy), operation.id]);
    app.setTime("2026-10-28T12:00:00.000Z");
    const operator = await app.login("operator@quire.local");
    await window(app, operator.headers, historyDays);
    // When: the original operation ID is downloaded under current policy.
    const response = await app.request(`/api/operations/${operation.id}/download`, { headers: owner.headers });
    // Then: finite legacy access fails closed, and unlimited access retains the original bytes.
    expect(response.status).toBe(historyDays === null ? 200 : 403);
    if (historyDays === null) expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(await app.runtime.blobs.get(legacy.blob)));
    else expect(error.parse(await response.json()).error.code).toBe("HISTORY_WINDOW");
    expect(await app.runtime.db.get("SELECT result_json FROM operations WHERE id=?", [operation.id]))
      .toEqual({ result_json: JSON.stringify(legacy) });
  });
}
for (const boundary of ["publication", "download"] as const) {
  test(`rechecks historical export policy at ${boundary} after actual byte preparation`, async () => {
    // Given: accessible old history and a downgrade at the real blob preparation seam.
    await using app = await reviewFixture();
    const owner = await app.login();
    app.setTime("2026-10-28T12:00:00.000Z");
    const operator = await app.login("operator@quire.local");
    const body = { kind: "source", snapshotId: ids.snapshot };
    const original = boundary === "download"
      ? z.object({ data: OperationSchema }).parse(await (await app.request(exportsPath, mutation(owner.headers, body))).json()).data
      : null;
    const get = app.runtime.blobs.get.bind(app.runtime.blobs);
    const barrier = spyOn(app.runtime.blobs, "get").mockImplementationOnce(async digest => {
      const bytes = await get(digest);
      await window(app, operator.headers, 1);
      return bytes;
    });
    try {
      // When: the pending publication/download resumes after policy changed outside SQL.
      const response = original
        ? await app.request(`/api/operations/${original.id}/download`, { headers: owner.headers })
        : await app.request(exportsPath, mutation(owner.headers, body));
      // Then: the final account fence rejects bytes prepared under expired authority.
      expect(response.status).toBe(403);
      expect(error.parse(await response.json()).error.code).toBe("HISTORY_WINDOW");
      if (original) expect(await app.runtime.db.get("SELECT id FROM operations WHERE id=?", [original.id])).toEqual({ id: original.id });
      else expect(await app.runtime.db.all("SELECT id FROM operations WHERE kind='source-export'")).toHaveLength(0);
    } finally { barrier.mockRestore(); }
  });
}
