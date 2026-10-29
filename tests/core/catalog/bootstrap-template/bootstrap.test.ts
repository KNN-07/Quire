import { expect, test } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { endpoints, resultSchema, ProjectSchema } from "@quire/contracts";
import { createRuntime, loadConfig } from "@quire/runtime";
import { applicationMigrations } from "../../../../apps/server/src/migrations";
import { register as identity } from "../../../../services/accounts/identity";
import { register as base, CoreProjects, readZip } from "../../../../services/core/base";
import { register as catalog } from "../../../../services/core/catalog";
import { Templates } from "../../../../services/core/catalog";
import { transition } from "../../../../services/core/catalog/publication";
import { fixtureIds } from "../../../fixtures/foundation";
import { seed } from "../../../../scripts/seed";
import { cleanBootstrap, seedCommand, password } from "./fixture";

test("documented clean CLI seed publishes stored starter content without expanding foundation seed", async () => {
  let root = "";
  {
    await using bootstrap = await cleanBootstrap();
    root = bootstrap.dataDir;
    const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: root }), {
      foundation: await applicationMigrations(),
      modules: [
        { id: "identity", lane: "A", order: 10, register: identity },
        { id: "base", lane: "K", order: 21, register: base },
        { id: "catalog", lane: "K", order: 24, register: catalog },
      ],
    });
    try {
      const request = (path: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers);
        headers.set("origin", "http://localhost:5173");
        headers.set("content-type", "application/json");
        return runtime.routes.fetch(new Request(`http://localhost:5173${path}`, { ...init, headers }));
      };
      const gallery = await request("/api/templates");
      expect(gallery.status).toBe(200);
      const versions = resultSchema(endpoints.templatesList.output).parse(await gallery.json());
      if ("error" in versions) throw new Error(versions.error.message);
      expect(versions.data.items).toHaveLength(1);
      const version = versions.data.items[0];
      if (!version) throw new Error("Starter version required");
      expect(version).toMatchObject({ name: "Starter Article", license: "CC0-1.0",
        visibility: "public", status: "published", version: 3 });
      const projectService = runtime.services.get("projects");
      if (!(projectService instanceof CoreProjects)) throw new Error("Native projects required");
      const snapshot = await projectService.readSnapshot(version.snapshotId);
      expect(snapshot.files.map(file => file.path)).toEqual(["main.tex"]);
      const original = await Bun.file(new URL("../../../../scripts/templates/article/main.tex", import.meta.url)).text();
      const file = snapshot.files[0];
      if (!file?.blob) throw new Error("Stored source blob required");
      expect(new TextDecoder().decode(await runtime.blobs.get(file.blob))).toBe(original);
      const archive = await runtime.db.get<{ id: string; result_json: string; actor_id: string }>(
        "SELECT id,result_json,actor_id FROM operations WHERE kind='source-export'",
      );
      if (!archive) throw new Error("Stored archive required");
      const metadata = z.object({ blob: z.string(), sourceSnapshots: z.array(z.object({ snapshotId: z.string() })) })
        .parse(JSON.parse(archive.result_json));
      expect(metadata.sourceSnapshots.map(item => item.snapshotId)).toEqual([version.snapshotId]);
      const { DigestSchema } = await import("@quire/contracts");
      const entries = readZip(await runtime.blobs.get(DigestSchema.parse(metadata.blob)));
      expect(entries.map(entry => entry.path)).toEqual(["main.tex"]);
      expect(new TextDecoder().decode(entries[0]?.bytes)).toBe(original);
      const login = await request("/api/auth/login", { method: "POST",
        body: JSON.stringify({ email: "outsider@quire.local", password }) });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      if (!cookie) throw new Error("Session cookie required");
      const me = await request("/api/me", { headers: { cookie } });
      const session = resultSchema(endpoints.me.output).parse(await me.json());
      if ("error" in session) throw new Error(session.error.message);
      expect(await runtime.db.get("SELECT operator FROM users WHERE id=?", [fixtureIds.outsider])).toEqual({ operator: 0 });
      const headers = { cookie, "x-csrf-token": session.data.csrfToken, "idempotency-key": crypto.randomUUID() };
      for (const action of ["approve", "publish"]) {
        expect((await request(`/api/templates/${version.templateId}/${action}`, { method: "POST", headers,
          body: JSON.stringify({ expectedVersion: version.version, versionId: version.id }) })).status).toBe(403);
      }
      expect((await request(`/api/templates/${version.templateId}`, { method: "PATCH", headers,
        body: JSON.stringify({ expectedVersion: version.version, name: "Hijacked" }) })).status).toBe(403);
      expect((await request("/api/projects", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ name: "Anonymous", origin: { kind: "template", templateVersionId: version.id } }) })).status).toBe(401);
      const created = await request("/api/projects", { method: "POST", headers, body: JSON.stringify({
        name: "Independent article", origin: { kind: "template", templateVersionId: version.id },
      }) });
      expect(created.status).toBe(200);
      const project = z.object({ data: ProjectSchema }).parse(await created.json()).data;
      expect(project.ownerId).toBe(fixtureIds.outsider);
      expect((await projectService.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId)).text).toBe(original);
      const source = await runtime.db.get<{ source_project_id: string }>("SELECT source_project_id FROM templates WHERE id=?", [version.templateId]);
      expect((await request(`/api/projects/${source?.source_project_id}?branch=main`, { headers })).status).toBe(404);
      expect((await request(`/api/operations/${archive.id}/download`, { headers })).status).toBe(404);
      expect((await request("/api/projects", { method: "POST", headers: { ...headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ name: "Wrong workspace", workspaceId: fixtureIds.team,
          origin: { kind: "template", templateVersionId: version.id } }) })).status).toBe(403);
      const scope = { projectId: project.id, branch: "main" };
      const document = await projectService.readDocument(scope, project.settings.mainFileId);
      await projectService.serialized(scope, lease => projectService.commitSource({
        actorId: fixtureIds.outsider, scope, lease,
        expectedRevision: document.file.version.revision,
        inputs: [{ file: document.file, bytes: new TextEncoder().encode("Preserved user edit\n") }],
      }));
      const before = await runtime.db.all("SELECT * FROM blobs ORDER BY digest");
      const snapshotsBefore = await runtime.db.all("SELECT * FROM snapshots ORDER BY id");
      const physicalBefore = (await readdir(`${root}/blobs`, { recursive: true })).sort();
      await seedCommand(root, "seed");
      expect(await runtime.db.all("SELECT * FROM blobs ORDER BY digest")).toEqual(before);
      expect(await runtime.db.all("SELECT * FROM snapshots ORDER BY id")).toEqual(snapshotsBefore);
      expect((await readdir(`${root}/blobs`, { recursive: true })).sort()).toEqual(physicalBefore);
      expect((await projectService.readDocument(scope, document.file.id)).text).toBe("Preserved user edit\n");
      expect(await runtime.db.all("SELECT id FROM templates")).toHaveLength(1);
      expect(await runtime.db.all("SELECT id FROM template_versions")).toHaveLength(1);
      expect(await runtime.db.all("SELECT id FROM operations WHERE kind='source-export'")).toHaveLength(1);
      expect(await runtime.db.all("SELECT * FROM catalog_roles")).toEqual([]);
      expect(await runtime.db.all("SELECT digest FROM blobs b WHERE NOT EXISTS(SELECT 1 FROM files f WHERE f.blob=b.digest) AND NOT EXISTS(SELECT 1 FROM snapshot_files s WHERE s.blob=b.digest) AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.result_json LIKE '%' || b.digest || '%')")).toEqual([]);
      const managed = await request("/api/templates", { method: "POST",
        headers: { ...headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ name: "User-managed draft", category: "Personal",
          description: "Keep this metadata", license: "MIT", visibility: "private", sourceProjectId: project.id }) });
      expect(managed.status).toBe(200);
      await transition(new Templates({ ...runtime, routes: runtime.routes.forLane("K") }), fixtureIds.operator, {
        id: version.templateId, expectedVersion: version.version, status: "unpublished",
      });
      const managedTemplates = await runtime.db.all("SELECT * FROM templates ORDER BY id");
      const managedVersions = await runtime.db.all("SELECT * FROM template_versions ORDER BY id");
      const managedBlobs = await runtime.db.all("SELECT * FROM blobs ORDER BY digest");
      const managedSnapshots = await runtime.db.all("SELECT * FROM snapshots ORDER BY id");
      const managedPhysical = (await readdir(`${root}/blobs`, { recursive: true })).sort();
      await seedCommand(root, "seed");
      expect(await runtime.db.all("SELECT * FROM templates ORDER BY id")).toEqual(managedTemplates);
      expect(await runtime.db.all("SELECT * FROM template_versions ORDER BY id")).toEqual(managedVersions);
      expect(await runtime.db.all("SELECT * FROM blobs ORDER BY digest")).toEqual(managedBlobs);
      expect(await runtime.db.all("SELECT * FROM snapshots ORDER BY id")).toEqual(managedSnapshots);
      expect((await readdir(`${root}/blobs`, { recursive: true })).sort()).toEqual(managedPhysical);
      console.info("BOOTSTRAP_STORED_VERIFIED", { root, version, projectId: project.id,
        archiveBlob: metadata.blob, blobs: before.length, physicalEntries: physicalBefore.length,
        unpublishedPreserved: true, userManagedDraftPreserved: true });
    } finally { await runtime.close(); }
  }
  await rejects(stat(root), { code: "ENOENT" });
}, 90_000);

test("foundation-only seed stays compatible and never promotes a pre-existing ordinary operator ID", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dataDir = await mkdtemp(join(tmpdir(), "quire-p40-foundation-"));
  const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: dataDir }));
  try {
    await seed(runtime, password);
    expect(await runtime.db.all("SELECT id FROM templates")).toEqual([]);
    await runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [fixtureIds.operator]);
    await seed(runtime, password);
    expect(await runtime.db.get("SELECT operator FROM users WHERE id=?", [fixtureIds.operator])).toEqual({ operator: 0 });
    const { seedStarterTemplate } = await import("../../../../scripts/seed-template");
    await rejects(seedStarterTemplate(runtime), { code: "SEED_TEMPLATE_OPERATOR_REQUIRED" });
    expect(await runtime.db.all("SELECT id FROM templates")).toEqual([]);
  } finally { await runtime.close(); await rm(dataDir, { recursive: true, force: true }); }
});
