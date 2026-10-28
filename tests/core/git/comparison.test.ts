import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { gitFixture } from "./harness";

test("T12 creates immutable working and staged comparison snapshots from exact Git trees", async () => {
  // Given: two separated browser edits with only one hunk staged.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const service = fixture.service();
  const initial = await fixture.status(owner.headers, project.id);
  const baseline = "\\documentclass{article}\n" + Array.from({ length: 24 }, (_, index) => `line ${index}\n`).join("");
  await service.serialized(scope, async lease => service.commitSource({
    lease, actorId: owner.user.id, scope, expectedRevision: initial.revision,
    inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(baseline) })),
  }));
  const baselineStatus = await fixture.status(owner.headers, project.id);
  await fixture.request(`/api/projects/${project.id}/git/stage`, {
    method: "PUT", headers: { ...owner.headers, "if-match": `"v${baselineStatus.revision}"` },
    body: JSON.stringify({
      scope, head: baselineStatus.head, hunkIds: baselineStatus.hunks.map(hunk => hunk.id),
      staged: true, expectedVersion: baselineStatus.revision,
    }),
  });
  await fixture.request(`/api/projects/${project.id}/git/commit`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      scope, head: baselineStatus.head, message: "Comparison baseline",
      compileFirst: false, expectedVersion: baselineStatus.revision,
    }),
  });
  const changed = baseline.replace("line 1\n", "staged edit\n").replace("line 22\n", "working edit\n");
  await service.serialized(scope, async lease => service.commitSource({
    lease, actorId: owner.user.id, scope,
    expectedRevision: (await service.getBranch(scope)).revision,
    inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(changed) })),
  }));
  const status = await fixture.status(owner.headers, project.id);
  expect(status.hunks).toHaveLength(2);
  const selected = status.hunks[0];
  if (!selected) throw new TypeError("Expected a staged comparison hunk");
  await fixture.request(`/api/projects/${project.id}/git/stage`, {
    method: "PUT", headers: { ...owner.headers, "if-match": `"v${status.revision}"` },
    body: JSON.stringify({
      scope, head: status.head, hunkIds: [selected.id], staged: true, expectedVersion: status.revision,
    }),
  });
  // When: the client requests exact working and staged snapshot pairs.
  const requests = await Promise.all(["working", "staged"].map(target =>
    fixture.request(`/api/projects/${project.id}/git/comparisons`, {
      method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ scope, head: status.head, target, expectedVersion: status.revision }),
    })));
  const pairs = await Promise.all(requests.map(async response => {
    expect(response.status, await response.clone().text()).toBe(200);
    const envelope = resultSchema(endpoints.gitComparisonCreate.output).parse(await response.json());
    if ("error" in envelope) throw new TypeError(envelope.error.message);
    return envelope.data;
  }));
  const working = pairs[0], staged = pairs[1];
  if (!working || !staged) throw new TypeError("Expected both comparison pairs");
  // Then: both compare against HEAD, while staged and working retain different immutable trees.
  expect(working.base.tree).toBe(staged.base.tree);
  expect(working.target.tree).not.toBe(working.base.tree);
  expect(staged.target.tree).not.toBe(staged.base.tree);
  expect(staged.target.tree).not.toBe(working.target.tree);
  const stagedFiles = await service.readSnapshot(staged.target.id);
  const stagedMain = stagedFiles.files.find(file => file.id === project.settings.mainFileId);
  if (!stagedMain?.blob) throw new TypeError("Expected staged main snapshot");
  expect(new TextDecoder().decode(await fixture.runtime.blobs.get(stagedMain.blob))).toContain("staged edit");
  expect(new TextDecoder().decode(await fixture.runtime.blobs.get(stagedMain.blob))).toContain("line 22");
  expect((await service.readDocument(scope, project.settings.mainFileId)).text).toBe(changed);
});
