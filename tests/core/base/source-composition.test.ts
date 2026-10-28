import { expect, test } from "bun:test";
import { z } from "zod";
import { GitOidSchema, IdSchema } from "@quire/contracts";
import type { BranchLease, Scope } from "@quire/contracts";
import { sourceIntent, git, repositoryPath } from "../../../services/core/base";
import type { SourceIntent } from "../../../services/core/base";
import { baseFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

type Fixture = Awaited<ReturnType<typeof baseFixture>>;
const main = { projectId: ids.project, branch: "main" };
async function prepare(app: Fixture, input: {
  readonly scope: Scope; readonly lease: BranchLease; readonly text: string; readonly newBranchId?: typeof ids.branch;
}) {
  const files = await app.service.listFiles(main);
  return app.service.prepareSource({
    actorId: ids.kien, scope: input.scope, lease: input.lease,
    expectedRevision: input.newBranchId ? 0 : (await app.service.getBranch(input.scope)).revision,
    inputs: files.map(file => file.id === ids.mainFile ? { file, bytes: new TextEncoder().encode(input.text) } : { file }),
    ...(input.newBranchId ? { newBranchId: input.newBranchId } : {}),
  });
}
const text = (value: string) => `\\documentclass{article}\n\\begin{document}${value}\\end{document}\n`;
async function publish(app: Fixture, input: { readonly id?: typeof ids.snapshot; readonly lease: BranchLease; readonly sources: readonly SourceIntent[] }) {
  const id = input.id ?? IdSchema.parse(crypto.randomUUID());
  const named = await Promise.all(input.sources.map(async source => {
    const previous = await app.runtime.db.get<{ head: string }>("SELECT head FROM branch_heads WHERE project_id=? AND branch=?",
      [source.snapshot.scope.projectId, source.snapshot.scope.branch]);
    return { ref: `refs/heads/${source.snapshot.scope.branch}`, expected: previous ? GitOidSchema.parse(previous.head) : null,
      next: GitOidSchema.parse(`sha1:${source.commit}`) };
  }));
  await app.runtime.repositories.publish({
    id, lease: input.lease, updates: [
      ...named,
      ...input.sources.map(source => ({ ref: `refs/quire/history/${source.snapshot.id}`, expected: null,
        next: GitOidSchema.parse(`sha1:${source.commit}`) })),
    ],
  });
  return id;
}

test("finalizes named publication and source in one supplied transaction", async () => {
  // Given: a prepared source that has not changed source state or opened a second intent.
  await using app = await baseFixture();
  const before = await app.service.readDocument(main, ids.mainFile);
  const originalHead = await git(repositoryPath(app.service.context, ids.project), ["rev-parse", "refs/heads/main"]);
  await app.service.serialized(main, async lease => {
    const source = await prepare(app, { scope: main, lease, text: text("composed") });
    expect((await app.service.readDocument(main, ids.mainFile)).text).toBe(before.text);
    expect(await app.runtime.db.get("SELECT id FROM base_source_intents")).toBeNull();
    expect(await git(repositoryPath(app.service.context, ids.project), ["rev-parse", "refs/heads/main"])).toBe(originalHead);
    const id = await publish(app, { lease, sources: [source] });
    const unavailable = await app.runtime.repositories.assertReadable(ids.project).then(() => null, (error: unknown) => error);
    expect(unavailable).toMatchObject({ code: "REPOSITORY_NOT_FINALIZED" });
    // When: source and named metadata finalize through the same transaction.
    await app.runtime.uow.run(async tx => {
      const events = await app.service.finalizePreparedSources(tx, { publication: { id, lease }, sources: [{ source, lease }] });
      await tx.run("UPDATE branch_heads SET head=?,version=version+1 WHERE project_id=? AND branch='main'",
        [`sha1:${source.commit}`, ids.project]);
      for (const event of events) await app.runtime.events.record(tx, event);
    });
    await app.runtime.events.dispatch();
    // Then: one finalized repository intent publishes the actual edited source.
    await app.runtime.repositories.assertReadable(ids.project);
    expect((await app.service.readDocument(main, ids.mainFile)).text).toBe(text("composed"));
    expect(await git(repositoryPath(app.service.context, ids.project), ["rev-parse", "refs/heads/main"])).toBe(source.commit);
    expect(await app.runtime.db.get<{ state: string }>("SELECT state FROM repository_intents WHERE id=?", [id]))
      .toEqual({ state: "finalized" });
    expect(await app.runtime.db.get("SELECT id FROM base_source_intents")).toBeNull();
  });
});

test("recovers a composed publication after metadata rollback without partial source", async () => {
  // Given: the durable external journal contains the prepared source before publication.
  await using app = await baseFixture();
  const before = await app.service.readDocument(main, ids.mainFile);
  const operationId = IdSchema.parse(crypto.randomUUID());
  await app.service.serialized(main, async lease => {
    const source = await prepare(app, { scope: main, lease, text: text("recovered composition") });
    const id = IdSchema.parse(crypto.randomUUID());
    await app.runtime.db.run(`INSERT INTO operations(id,actor_id,kind,status,result_json,created_at,updated_at)
      VALUES(?,?,'composition-test','running',?,?,?)`, [operationId, ids.kien, JSON.stringify({ source, id }),
      app.runtime.clock.now(), app.runtime.clock.now()]);
    await publish(app, { id, lease, sources: [source] });
    // When: a later named-metadata write fails after source finalization.
    const failure = await app.runtime.uow.run(async tx => {
      await app.service.finalizePreparedSources(tx, { publication: { id, lease }, sources: [{ source, lease }] });
      throw new Error("injected named metadata failure");
    }).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((await app.service.readDocument(main, ids.mainFile)).text).toBe(before.text);
  });
  await app.restart();
  const row = z.object({ result_json: z.string() }).parse(await app.runtime.db.get(
    "SELECT result_json FROM operations WHERE id=?", [operationId]));
  const restored = z.object({ source: sourceIntent, id: IdSchema }).parse(JSON.parse(row.result_json));
  await app.service.serialized(main, async lease => {
    await app.runtime.repositories.recover(restored.id, lease);
    await app.runtime.uow.run(async tx => {
      const events = await app.service.finalizePreparedSources(tx, {
        publication: { id: restored.id, lease }, sources: [{ source: restored.source, lease }],
      });
      await tx.run("UPDATE branch_heads SET head=?,version=version+1 WHERE project_id=? AND branch='main'",
        [`sha1:${restored.source.commit}`, ids.project]);
      await tx.run("UPDATE operations SET status='succeeded' WHERE id=?", [operationId]);
      for (const event of events) await app.runtime.events.record(tx, event);
    });
  });
  // Then: a fresh process state consumes the persisted descriptor and publishes once.
  expect((await app.service.readDocument(main, ids.mainFile)).text).toBe(text("recovered composition"));
  await app.runtime.repositories.assertReadable(ids.project);
});

test("prepares a new branch without exposing it and finalizes a multi-branch batch", async () => {
  // Given: two snapshots share the same original project version.
  await using app = await baseFixture();
  const feature = { projectId: ids.project, branch: "composed-feature" };
  await app.service.serialized(main, async lease => {
    const featureLease = await app.runtime.branches.acquire(feature, crypto.randomUUID(), 60000);
    if (!featureLease) throw new TypeError("Expected feature lease");
    try {
      const primary = await prepare(app, { scope: main, lease, text: text("main batch") });
      const secondary = await prepare(app, { scope: feature, lease: featureLease,
        text: text("feature batch"), newBranchId: IdSchema.parse(crypto.randomUUID()) });
      expect(await app.runtime.db.get("SELECT id FROM branch_workspaces WHERE project_id=? AND branch=?",
        [ids.project, feature.branch])).toBeNull();
      const id = await publish(app, { lease, sources: [primary, secondary] });
      // When: all branches validate before this transaction advances the shared project version.
      await app.runtime.uow.run(async tx => {
        const events = await app.service.finalizePreparedSources(tx, {
          publication: { id, lease }, sources: [{ source: primary, lease }, { source: secondary, lease: featureLease }],
        });
        for (const source of [primary, secondary]) await tx.run(
          `INSERT INTO branch_heads(project_id,branch,head) VALUES(?,?,?)
           ON CONFLICT(project_id,branch) DO UPDATE SET head=excluded.head,version=branch_heads.version+1`,
          [source.snapshot.scope.projectId, source.snapshot.scope.branch, `sha1:${source.commit}`]);
        for (const event of events) await app.runtime.events.record(tx, event);
      });
      // Then: both branch trees appear together, with no standalone source publication.
      expect((await app.service.readDocument(main, ids.mainFile)).text).toBe(text("main batch"));
      expect((await app.service.readDocument(feature, ids.mainFile)).text).toBe(text("feature batch"));
      expect(await git(repositoryPath(app.service.context, ids.project), ["rev-parse", `refs/heads/${feature.branch}`])).toBe(secondary.commit);
    } finally { await app.runtime.branches.release(featureLease); }
  });
});

test("rejects source finalization when the publication omits its checkpoint", async () => {
  // Given: a valid named publication that does not include the prepared source checkpoint.
  await using app = await baseFixture();
  const before = await app.service.readDocument(main, ids.mainFile);
  await app.service.serialized(main, async lease => {
    const source = await prepare(app, { scope: main, lease, text: text("must not publish") });
    const id = IdSchema.parse(crypto.randomUUID());
    const previous = await git(repositoryPath(app.service.context, ids.project), ["rev-parse", "refs/heads/main"]);
    await app.runtime.repositories.publish({ id, lease, updates: [{
      ref: "refs/heads/main", expected: GitOidSchema.parse(`sha1:${previous}`), next: GitOidSchema.parse(`sha1:${source.commit}`),
    }] });
    // When: a caller tries to bind source metadata to that incomplete publication.
    const failure = await app.runtime.uow.run(tx => app.service.finalizePreparedSources(tx, {
      publication: { id, lease }, sources: [{ source, lease }],
    })).then(() => null, (error: unknown) => error);
    // Then: no source state is exposed or finalized.
    expect(failure).toMatchObject({ code: "SOURCE_PUBLICATION_MISMATCH" });
    expect((await app.service.readDocument(main, ids.mainFile)).text).toBe(before.text);
  });
});

test("can prepare a new branch from immutable blobs without source mutation", async () => {
  // Given: existing persisted file entries rather than newly uploaded bytes.
  await using app = await baseFixture();
  const scope = { projectId: ids.project, branch: "blob-copy" };
  const lease = await app.runtime.branches.acquire(scope, crypto.randomUUID(), 60000);
  if (!lease) throw new TypeError("Expected branch lease");
  try {
    const before = await app.service.readDocument(main, ids.mainFile);
    // When: preparation materializes the new document state from those immutable blobs.
    const source = await app.service.prepareSource({
      actorId: ids.kien, scope, lease, expectedRevision: 0, newBranchId: IdSchema.parse(crypto.randomUUID()),
      inputs: (await app.service.listFiles(main)).map(file => ({ file })),
    });
    // Then: source text is preserved and no branch is visible before finalization.
    expect(source.documents.find(document => document.fileId === ids.mainFile)?.text).toBe(before.text);
    expect(await app.runtime.db.get("SELECT id FROM branch_workspaces WHERE project_id=? AND branch=?", [ids.project, scope.branch])).toBeNull();
  } finally { await app.runtime.branches.release(lease); }
});
