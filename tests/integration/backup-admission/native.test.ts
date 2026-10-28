import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { endpoints, GitOidSchema } from "@quire/contracts";
import { createLocalAdapters, createRuntime, loadConfig, referenceBlob } from "@quire/runtime";
import { createApplication, modules } from "../../../apps/server/src/composition";
import { createBackup, verifyBackup } from "../../../services/operations/backups";
import { backupHost } from "../../../services/operations/backups/model";
import { exportDatabase } from "../../../services/operations/backups/database";
import { exportRepository } from "../../../services/operations/backups/repositories";
import { seed } from "../../../scripts/seed";
import { fixtureIds } from "../../fixtures/foundation";
import { bounded } from "../portable/process";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "quire-backup-admission-native-"));
  const app = await createApplication({
    config: loadConfig({ QUIRE_DATA_DIR: root, QUIRE_COMPILER_BACKEND: "docker" }),
    modules: modules.map(module => ({ ...module, register: () => undefined })),
  });
  await seed(app.runtime, "quire-admission-native-test");
  return {
    ...app,
    async [Symbol.asyncDispose]() {
      await app.close();
      await rm(root, { recursive: true, force: true });
      console.info("ADMISSION_NATIVE_CLEANED", root);
    },
  };
}

test("drains an actual HTTP SQL/blob/Git writer before exporting all source references", async () => {
  // Given a real application and an HTTP writer held before its ref/SQL publication.
  await using app = await fixture();
  const { runtime } = app;
  const entered = Promise.withResolvers<void>();
  const publish = Promise.withResolvers<void>();
  const captured = Promise.withResolvers<void>();
  const finishBackup = Promise.withResolvers<void>();
  const project = fixtureIds.project;
  const body = new TextEncoder().encode("admission blob and Git source");
  runtime.routes.forLane("K").registerTransport(endpoints.projectGet, async () => {
    const hash = await runtime.blobs.put(body);
    const oid = new TextDecoder().decode(await runtime.repositories.objects(project, ["hash-object", "-w", "--stdin"], body)).trim();
    entered.resolve();
    await publish.promise;
    await runtime.uow.run(async tx => {
      await referenceBlob(tx, { digest: hash, bytes: body.length }, runtime.clock);
      await tx.run("UPDATE projects SET name=? WHERE id=?", [oid, project]);
    });
    return Response.json({ oid, hash });
  });
  const request = () => app.fetch(new Request(`http://localhost/api/projects/${project}`));
  const writing = request();
  await bounded(entered.promise);

  // When exclusive admission starts before that writer has published.
  const backup = runtime.admission.exclusive(async () => {
    const database = await exportDatabase(runtime);
    const repository = await exportRepository(runtime, project);
    const row = database.tables.find(table => table.name === "projects")?.rows.find(value => value["id"] === project);
    const oid = GitOidSchema.parse(`sha1:${z.string().parse(row?.["name"])}`);
    expect(new TextDecoder().decode(await runtime.repositories.objects(project, ["cat-file", "-p", oid.slice(5)]))).toBe(
      new TextDecoder().decode(body));
    expect(repository.metadata.objects).toBeGreaterThan(0);
    captured.resolve();
    await finishBackup.promise;
  });
  try {
    expect((await request()).status).toBe(503);
    publish.resolve();
    expect((await bounded(writing)).status).toBe(200);
    await bounded(captured.promise);
    await rejects(runtime.db.run("UPDATE projects SET name='forbidden' WHERE id=?", [project]), { code: "BACKUP_MAINTENANCE" });
  } finally { publish.resolve(); finishBackup.resolve(); await bounded(backup); }

  // Then the actual configured host creates a complete, verifiable archive.
  const archive = await createBackup(runtime);
  const verified = await verifyBackup(archive.destination, runtime.secretKey, backupHost(runtime).signingKey);
  expect(verified.manifest.repositories.map(item => item.projectId)).toContain(project);
  expect(modules.filter(module => module.id === "041-o-backups")).toHaveLength(1);
}, 120000);

test("keeps admission closed through failure cleanup and releases after rejection", async () => {
  // Given exclusive maintenance whose cleanup is held at an explicit barrier.
  await using app = await fixture();
  const cleaning = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const failed = rejects(app.runtime.admission.exclusive(async () => {
    try { throw new Error("owned backup failure"); }
    finally { cleaning.resolve(); await cleanup.promise; }
  }), /owned backup failure/);
  await bounded(cleaning.promise);
  // When an unrelated source writer enters during cleanup.
  await rejects(app.runtime.uow.run(tx => tx.run("UPDATE projects SET name='forbidden'")), { code: "BACKUP_MAINTENANCE" });
  cleanup.resolve();
  await failed;
  // Then admission is reopened after the cleanup completed.
  const result = await app.runtime.db.run("UPDATE projects SET name=? WHERE id=?", ["after failure", fixtureIds.project]);
  expect(result.changes).toBe(1);
}, 120000);

test("drains detached registered worker work and rejects an expired async scope", async () => {
  // Given a worker registered inside an HTTP-like operation but finishing later.
  await using app = await fixture();
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const resumed = Promise.withResolvers<void>();
  let late: Promise<void> | undefined;
  const worker = app.runtime.admission.writer(async () => {
    late = resumed.promise.then(async () => {
      await app.runtime.db.run("UPDATE projects SET name='stale'");
    });
    void app.runtime.admission.writer(async () => {
      entered.resolve();
      await finish.promise;
      await app.runtime.db.run("UPDATE projects SET name='worker completed'");
    });
  });
  await bounded(entered.promise);
  // When backup closes admission while registered worker cleanup is still active.
  const backup = app.runtime.admission.exclusive(async () => {
    expect(await app.runtime.db.get<{ name: string }>("SELECT name FROM projects WHERE id=?", [fixtureIds.project])).toEqual({ name: "worker completed" });
  });
  finish.resolve();
  await bounded(Promise.all([worker, backup]));
  // Then work escaping the completed scope cannot silently acquire fresh authority.
  const stale = rejects(late ?? Promise.reject(new Error("worker did not register")), { code: "ADMISSION_EXPIRED" });
  resumed.resolve();
  await stale;
}, 120000);

test("preserves native pipe bytes when Git receives Bun Response.bytes output", async () => {
  // Given real native Bun pipe bytes rather than a fabricated typed array.
  await using app = await fixture();
  const child = Bun.spawn(["printf", "native pipe source"], { stdout: "pipe", stderr: "pipe" });
  const bytes = await new Response(child.stdout).bytes();
  expect(await child.exited).toBe(0);
  // When the repository subprocess receives those bytes.
  const oid = new TextDecoder().decode(await app.runtime.repositories.objects(fixtureIds.project,
    ["hash-object", "-w", "--stdin"], bytes)).trim();
  // Then stdin normalization preserves the exact stored object.
  expect(new TextDecoder().decode(await app.runtime.repositories.objects(fixtureIds.project, ["cat-file", "-p", oid]))).toBe("native pipe source");
}, 120000);

test("fails backup registration when a custom adapter factory supplies no exclusion host", async () => {
  // Given an adapter factory that omits admission despite exposing writable storage.
  const root = await mkdtemp(join(tmpdir(), "quire-backup-unconfigured-"));
  try {
    // When backup module registration is requested.
    const startup = createRuntime(loadConfig({ QUIRE_DATA_DIR: root }), {
      modules: [{ id: "041-o-backups", lane: "O", order: 41, register: () => undefined }],
      createAdapters: async (config, clock) => {
        const { admission: _admission, ...adapters } = await createLocalAdapters(config, clock);
        return adapters;
      },
    });
    // Then startup fails rather than manufacturing a quiescence assertion.
    await rejects(startup, { code: "BACKUP_QUIESCENCE_REQUIRED" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
