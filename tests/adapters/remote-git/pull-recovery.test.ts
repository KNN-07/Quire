import { expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { GitRepository } from "../../../services/core/git";
import { githubFixture } from "./provider-fixture";
import { remoteGitHarness } from "./harness";
import { action, importProject, operation } from "./test-helpers";

setDefaultTimeout(20_000);

test("pulls fast-forward changes and creates an explicit conflict branch without overwriting main", async () => {
  // Given
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin);
  await app.configure();
  const owner = await app.login();
  const grant = await app.connect(owner);
  const imported = await operation(await importProject({
    app, session: owner, grantId: grant.id, origin: provider.origin,
  }));
  const projectId = z.object({ projectId: IdSchema }).parse(imported.result).projectId;
  await provider.commit(
    "owner/research",
    "\\documentclass{article}\n\\begin{document}Remote fast forward\\end{document}\n",
    "Remote fast forward",
  );
  // When
  const pulled = await operation(await action({
    app, session: owner, grantId: grant.id, grantVersion: grant.version,
    name: "pull", projectId, parameters: { expectedBindingVersion: 1 },
  }));
  const binding = z.object({ version: z.number() }).parse(await app.runtime.db.get(
    "SELECT version FROM remote_bindings WHERE project_id=?", [projectId],
  ));
  const pullState = z.object({ cursor: z.string().nullable() }).parse(await app.runtime.db.get(
    "SELECT cursor FROM adapter_cursors WHERE grant_id=? AND action='pull' AND project_id=?",
    [grant.id, projectId],
  ));
  const projects = app.projects;
  const scope = { projectId, branch: "main" };
  const repository = new GitRepository(projects);
  await projects.serialized(scope, async (lease) => {
    const before = await repository.head(owner.user.id, scope, lease);
    const branch = await projects.getBranch(scope);
    const files = await projects.listFiles(scope);
    const main = (await projects.getProject(projectId)).settings.mainFileId;
    const snapshot = await projects.commitSource({
      actorId: owner.user.id, scope, lease, expectedRevision: branch.revision,
      inputs: files.map((file) => file.id === main ? {
        file, bytes: new TextEncoder().encode(
          "\\documentclass{article}\n\\begin{document}Local divergence\\end{document}\n",
        ),
      } : { file }),
    });
    const after = await repository.commitTree(owner.user.id, {
      scope, tree: snapshot.tree.slice(snapshot.tree.indexOf(":") + 1),
      parents: [before], message: "Local divergence",
    });
    await repository.journal.publish(owner.user.id, [{
      scope, before, after, hydrate: false,
    }], [lease]);
  });
  await provider.commit(
    "owner/research",
    "\\documentclass{article}\n\\begin{document}Remote divergence\\end{document}\n",
    "Remote divergence",
  );
  const conflicted = await operation(await action({
    app, session: owner, grantId: grant.id, grantVersion: grant.version,
    name: "pull", projectId, parameters: { expectedBindingVersion: binding.version },
    expectedCursor: pullState.cursor,
  }));
  // Then
  expect(z.object({ status: z.literal("pulled") }).parse(pulled.result).status).toBe("pulled");
  const conflict = z.object({
    status: z.literal("conflict"), conflictBranch: z.string(),
  }).parse(conflicted.result);
  const project = await projects.getProject(projectId);
  expect((await projects.readDocument(scope, project.settings.mainFileId)).text).toContain("Local divergence");
  expect((await projects.readDocument(
    { projectId, branch: conflict.conflictBranch }, project.settings.mainFileId,
  )).text).toContain("Remote divergence");
});

test("recovers fenced imported source and receipt after publication transaction rollback", async () => {
  // Given
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin);
  await app.configure();
  const owner = await app.login();
  const grant = await app.connect(owner);
  const key = crypto.randomUUID();
  const originalRecord = app.runtime.events.record.bind(app.runtime.events);
  let injected = false;
  const record = spyOn(app.runtime.events, "record").mockImplementation(async (tx, event) => {
    if (!injected && event.topic === "tree.changed") {
      injected = true;
      throw new TypeError("injected remote Git finalization rollback");
    }
    return originalRecord(tx, event);
  });
  // When
  const failed = await importProject({
    app, session: owner, grantId: grant.id, origin: provider.origin, key,
  });
  record.mockRestore();
  expect(failed.status).toBe(502);
  const before = z.object({ id: z.string(), status: z.literal("failed") }).parse(
    await app.runtime.db.get(
      "SELECT id,status FROM operations WHERE actor_id=? AND idempotency_key=?",
      [owner.user.id, key],
    ),
  );
  await app.restart();
  // Then
  const recovered = z.object({
    status: z.literal("succeeded"), result_json: z.string(),
  }).parse(await app.runtime.db.get(
    "SELECT status,result_json FROM operations WHERE id=?", [before.id],
  ));
  const result = z.object({ projectId: IdSchema }).parse(JSON.parse(recovered.result_json));
  expect((await app.projects.getProject(result.projectId)).name).toBe("Imported remote project");
  expect(await app.runtime.db.get("SELECT id FROM remote_git_intents")).toBeNull();
});
