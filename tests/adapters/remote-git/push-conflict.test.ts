import { expect, setDefaultTimeout, test } from "bun:test";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { GitRepository } from "../../../services/core/git";
import { githubFixture } from "./provider-fixture";
import { remoteGitHarness } from "./harness";

const operationEnvelope = z.object({ data: OperationSchema });
const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });
setDefaultTimeout(20_000);

test("pushes a deterministic conflict branch when the remote moved and rejects stale binding versions", async () => {
  // Given
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin);
  await app.configure();
  const owner = await app.login();
  const grant = await app.connect(owner);
  const importedResponse = await app.request("/api/imports", {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      kind: "github",
      name: "Push conflict project",
      source: {
        kind: "git",
        url: `${provider.origin}/owner/research.git`,
        branch: "main",
        grantId: grant.id,
      },
    }),
  });
  const imported = operationEnvelope.parse(await importedResponse.json()).data;
  const projectId = z.object({ projectId: IdSchema }).parse(imported.result).projectId;
  const project = await app.projects.getProject(projectId);
  const scope = { projectId, branch: "main" };
  const repository = new GitRepository(app.projects);
  await app.projects.serialized(scope, async (lease) => {
    const before = await repository.head(owner.user.id, scope, lease);
    const branch = await app.projects.getBranch(scope);
    const files = await app.projects.listFiles(scope);
    const snapshot = await app.projects.commitSource({
      actorId: owner.user.id,
      scope,
      lease,
      expectedRevision: branch.revision,
      inputs: files.map((file) => file.id === project.settings.mainFileId
        ? {
          file,
          bytes: new TextEncoder().encode(
            "\\documentclass{article}\n\\begin{document}Local push conflict\\end{document}\n",
          ),
        }
        : { file }),
    });
    const after = await repository.commitTree(owner.user.id, {
      scope,
      tree: snapshot.tree.slice(snapshot.tree.indexOf(":") + 1),
      parents: [before],
      message: "Local push conflict",
    });
    await repository.journal.publish(owner.user.id, [{
      scope,
      before,
      after,
      hydrate: false,
    }], [lease]);
  });
  await provider.commit(
    "owner/research",
    "\\documentclass{article}\n\\begin{document}Remote push conflict\\end{document}\n",
    "Remote push conflict",
  );
  // When
  const pushedResponse = await app.request(`/api/connections/${grant.id}/actions`, {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      action: "push",
      projectId,
      parameters: { expectedBindingVersion: 1 },
      expectedVersion: grant.version,
      expectedCursor: null,
    }),
  });
  const pushed = operationEnvelope.parse(await pushedResponse.json()).data;
  const conflict = z.object({
    status: z.literal("conflict"),
    conflictBranch: z.string(),
  }).parse(pushed.result);
  const cursor = z.object({ cursor: z.string().nullable() }).parse(await app.runtime.db.get(
    "SELECT cursor FROM adapter_cursors WHERE grant_id=? AND action='push' AND project_id=?",
    [grant.id, projectId],
  )).cursor;
  const staleResponse = await app.request(`/api/connections/${grant.id}/actions`, {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      action: "push",
      projectId,
      parameters: { expectedBindingVersion: 1 },
      expectedVersion: grant.version,
      expectedCursor: cursor,
    }),
  });
  // Then
  expect(await provider.read("owner/research", "main.tex")).toContain("Remote push conflict");
  expect(await provider.read("owner/research", "main.tex", conflict.conflictBranch)).toContain("Local push conflict");
  expect(errorEnvelope.parse(await staleResponse.json()).error.code).toBe("VERSION_CONFLICT");
});
