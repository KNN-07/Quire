import { expect, test } from "bun:test";
import { EnvironmentSchema, FileEntrySchema } from "@quire/contracts";
import { gitFixture } from "./harness";
import { run } from "../../../services/core/git/process";
import { repositoryPath } from "../../../services/core/base";

test("T11 preserves an eligible unlinked main.Rnw identity through named Git commit", async () => {
  // Given: the project selects a persisted Docker environment with the knitr helper.
  await using fixture = await gitFixture({ compiler: true });
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  await fixture.status(owner.headers, project.id);
  const environment = EnvironmentSchema.parse({
    id: crypto.randomUUID(), label: "Docker knitr", release: "test", backend: "docker",
    rootOrImageDigest: "sha256:test", engines: ["pdflatex"], helpers: ["knitr"],
    packagesDigest: "a".repeat(64), experimental: false, available: true,
    probeAt: "2026-10-27T00:00:00.000Z",
  });
  await fixture.runtime.db.run(`INSERT INTO environments
    (id,label,release,backend,manifest_json,available,probe_at,created_at) VALUES(?,?,?,?,?,?,?,?)`, [
    environment.id, environment.label, environment.release, environment.backend,
    JSON.stringify(environment), 1, environment.probeAt, fixture.runtime.clock.now(),
  ]);
  await fixture.runtime.db.run("UPDATE projects SET settings_json=? WHERE id=?", [
    JSON.stringify({ ...project.settings, environmentId: environment.id }), project.id,
  ]);
  const service = fixture.service();
  const original = await service.readDocument(scope, project.settings.mainFileId);
  const renamed = FileEntrySchema.parse({ ...original.file, path: "main.Rnw", link: null });
  await service.serialized(scope, async lease => service.commitSource({
    lease, actorId: owner.user.id, scope,
    expectedRevision: (await service.getBranch(scope)).revision,
    inputs: [{ file: renamed, bytes: new TextEncoder().encode(original.text) }],
  }));
  const status = await fixture.status(owner.headers, project.id);
  await fixture.request(`/api/projects/${project.id}/git/stage`, {
    method: "PUT", headers: { ...owner.headers, "if-match": `"v${status.revision}"` },
    body: JSON.stringify({
      scope, head: status.head, hunkIds: status.hunks.map(hunk => hunk.id),
      staged: true, expectedVersion: status.revision,
    }),
  });
  // When: the renamed main file is committed through real Git.
  const committed = await fixture.request(`/api/projects/${project.id}/git/commit`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      scope, head: status.head, message: "Use knitr main", compileFirst: false,
      expectedVersion: status.revision,
    }),
  });
  // Then: the named tree contains main.Rnw and the configured file identity stays stable and editable.
  expect(committed.status, await committed.clone().text()).toBe(202);
  const names = (await run({
    path: repositoryPath(service.context, project.id), args: ["ls-tree", "--name-only", "main"],
  })).text.split("\n");
  expect(names).toContain("main.Rnw");
  const main = await service.getFile(scope, project.settings.mainFileId);
  expect(main).toMatchObject({ id: project.settings.mainFileId, path: "main.Rnw", editable: true, link: null });
}, 120000);
