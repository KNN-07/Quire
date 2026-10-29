import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { GitOidSchema, IdSchema } from "@quire/contracts";
import { migrateDatabase } from "@quire/runtime";
import { baseFixture } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";
import { migrations as catalogMigrations } from "../../../services/core/catalog";
import { seedStarterTemplate } from "../../../scripts/seed-template";

const bytes = new TextEncoder().encode("\\documentclass{article}\n\\begin{document}Atomic creation\\end{document}\n");

test("ordinary blank, example, template and file creation retain valid source after extraction", async () => {
  await using app = await baseFixture();
  await migrateDatabase(app.runtime.uow, catalogMigrations);
  await seedStarterTemplate(app.runtime);
  for (const kind of ["blank", "example"] as const) {
    const project = await app.service.create(fixtureIds.kien, { name: kind, origin: { kind } });
    expect((await app.service.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId)).text)
      .toContain("\\documentclass");
  }
  const template = await app.runtime.db.get<{ id: string }>("SELECT id FROM template_versions WHERE status IN ('approved','published') LIMIT 1");
  if (!template) throw new Error("Seeded approved template required");
  const project = await app.service.create(fixtureIds.kien, { name: "Template regression",
    origin: { kind: "template", templateVersionId: IdSchema.parse(template.id) } });
  expect((await app.service.listFiles({ projectId: project.id, branch: "main" })).length).toBeGreaterThan(0);
  const imported = await app.service.createFromFiles(fixtureIds.kien, {
    name: "Nested import", entries: [{ path: "nested/main.tex", bytes }], mainPath: "nested/main.tex",
  });
  expect((await app.service.readDocument({ projectId: imported.id, branch: "main" }, imported.settings.mainFileId)).text)
    .toBe(new TextDecoder().decode(bytes));
});

test("creation metadata, source and caller-owned dependent writes roll back together", async () => {
  await using app = await baseFixture();
  const creation = await app.service.prepareCreation(fixtureIds.kien, { name: "Atomic", entries: [{ path: "main.tex", bytes }] });
  const scope = { projectId: creation.project.id, branch: "main" };
  expect(await app.runtime.db.get("SELECT id FROM projects WHERE id=?", [scope.projectId])).toBeNull();
  await app.runtime.repositories.initialize(scope.projectId);
  await app.service.serialized(scope, async lease => {
    const source = await app.service.prepareSource({ actorId: fixtureIds.kien, scope, lease,
      expectedRevision: 0, inputs: creation.inputs, creation });
    await app.runtime.repositories.publish({ id: source.snapshot.id, lease,
      updates: [{ ref: `refs/quire/history/${source.snapshot.id}`, expected: null, next: GitOidSchema.parse(`sha1:${source.commit}`) }] });
    const finalization = { publication: { id: source.snapshot.id, lease }, sources: [{ source, lease, creation: creation.project }] };
    await rejects(app.runtime.uow.run(async tx => {
      await app.service.finalizePreparedSources(tx, finalization);
      throw new Error("dependent binding/receipt failure");
    }), /dependent binding\/receipt failure/);
    for (const table of ["projects", "repositories", "branch_workspaces", "snapshots"]) {
      expect(await app.runtime.db.get(`SELECT 1 FROM ${table} WHERE ${table === "projects" ? "id" : "project_id"}=?`, [scope.projectId])).toBeNull();
    }
    await app.runtime.uow.run(tx => app.service.finalizePreparedSources(tx, finalization));
    expect((await app.service.readDocument(scope, creation.project.settings.mainFileId)).text).toBe(new TextDecoder().decode(bytes));
    await rejects(app.runtime.uow.run(tx => app.service.finalizePreparedSources(tx, finalization)), {
      code: "SOURCE_CREATION_EXISTS",
    });
  });
});

test("prepared creation rejects mismatched owner and stale workspace under transaction lock", async () => {
  await using app = await baseFixture();
  const creation = await app.service.prepareCreation(fixtureIds.kien, {
    name: "Protected creation", entries: [{ path: "main.tex", bytes }], workspaceId: fixtureIds.team,
  });
  const scope = { projectId: creation.project.id, branch: "main" };
  await app.runtime.repositories.initialize(scope.projectId);
  await app.service.serialized(scope, async lease => {
    const source = await app.service.prepareSource({ actorId: fixtureIds.kien, scope, lease,
      expectedRevision: 0, inputs: creation.inputs, creation });
    await app.runtime.repositories.publish({ id: source.snapshot.id, lease,
      updates: [{ ref: `refs/quire/history/${source.snapshot.id}`, expected: null, next: GitOidSchema.parse(`sha1:${source.commit}`) }] });
    for (const mismatched of [
      { ...creation.project, ownerId: fixtureIds.mai },
      { ...creation.project, id: fixtureIds.project },
      { ...creation.project, defaultBranch: "wrong-branch" },
      { ...creation.project, version: 1 },
    ]) {
      await rejects(app.runtime.uow.run(tx => app.service.finalizePreparedSources(tx, {
        publication: { id: source.snapshot.id, lease }, sources: [{ source, lease, creation: mismatched }],
      })), { code: "SOURCE_CREATION_MISMATCH" });
    }
    await rejects(app.runtime.uow.run(tx => app.service.finalizePreparedSources(tx, {
      publication: { id: source.snapshot.id, lease },
      sources: [{ source: { ...source, snapshot: { ...source.snapshot, authorId: fixtureIds.mai } }, lease, creation: creation.project }],
    })), { code: "SOURCE_CREATION_MISMATCH" });
    await rejects(app.runtime.uow.run(tx => app.service.finalizePreparedSources(tx, {
      publication: { id: source.snapshot.id, lease },
      sources: [{ source: { ...source, branchId: fixtureIds.branch }, lease, creation: creation.project }],
    })), { code: "SOURCE_CREATION_EXISTS" });
    await app.runtime.db.run("DELETE FROM members WHERE organization_id=? AND user_id=?", [fixtureIds.team, fixtureIds.kien]);
    await rejects(app.runtime.uow.run(tx => app.service.finalizePreparedSources(tx, {
      publication: { id: source.snapshot.id, lease }, sources: [{ source, lease, creation: creation.project }],
    })), { code: "FORBIDDEN" });
    expect(await app.runtime.db.get("SELECT id FROM projects WHERE id=?", [scope.projectId])).toBeNull();
  });
});
