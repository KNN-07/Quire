import { test, expect } from "bun:test";
import { z } from "zod";
import { CompileJobSchema } from "@quire/contracts";
import { nativeEnvironmentId } from "../../../services/compiler";
import { gitFixture } from "./harness";
import { run, raw } from "../../../services/core/git/process";
import { repositoryPath } from "../../../services/core/base";

for (const valid of [true, false]) {
  test(`T11 real compiler ${valid ? "allows successful" : "blocks failed"} compile-before-commit`, async () => {
    // Given: an actual confined compiler, real source, and fully staged changes.
    await using fixture = await gitFixture({ compiler: true });
    const owner = await fixture.login();
    const project = await fixture.create(owner.headers);
    const scope = { projectId: project.id, branch: "main" };
    const service = fixture.service();
    await service.patch(owner.user.id, { projectId: project.id, expectedVersion: service.getProject(project.id).version,
      settings: { ...project.settings, environmentId: nativeEnvironmentId } });
    await fixture.status(owner.headers, project.id);
    const original = service.readDocument(scope, project.settings.mainFileId).text;
    const changed = original.replace("\\end{document}", `${valid ? "Compiled Git source." : "\\QuireMissingCommand"}\n\\end{document}`);
    await service.serialized(scope, () => service.commitSource({ actorId: owner.user.id, scope,
      expectedRevision: service.getBranch(scope).revision,
      inputs: service.listFiles(scope).map(file => ({ file, bytes: new TextEncoder().encode(changed) })) }));
    const status = await fixture.status(owner.headers, project.id);
    const staged = await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
      headers: { ...owner.headers, "if-match": `"v${status.revision}"` },
      body: JSON.stringify({ scope, head: status.head, hunkIds: status.hunks.map(h => h.id), staged: true, expectedVersion: status.revision }) });
    expect(staged.status).toBe(200);
    // When: the authenticated HTTP commit runs the real compilation gate.
    const response = await fixture.request(`/api/projects/${project.id}/git/commit`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ scope, head: status.head, message: "Compiler gate", compileFirst: true, expectedVersion: status.revision }) });
    // Then: named history advances only for a successfully compiled exact source tree.
    expect(response.status, JSON.stringify(fixture.failures)).toBe(valid ? 202 : 409);
    const after = await fixture.status(owner.headers, project.id);
    expect(after.head === status.head).toBe(!valid);
    const rows = fixture.runtime.db.query("SELECT id FROM compile_jobs").all();
    const jobId = z.array(z.object({ id: z.string() })).parse(rows)[0]?.id;
    if (!jobId) throw new TypeError("Expected real compile job");
    const result = await fixture.request(`/api/compiles/${jobId}`, { headers: owner.headers });
    const job = z.object({ data: CompileJobSchema }).parse(await result.json()).data;
    expect(job.status).toBe(valid ? "succeeded" : "failed");
    if (valid) expect(job.artifacts.some(artifact => artifact.kind === "pdf")).toBe(true);
  }, 120000);
}

test("T11 compiles only staged bytes while invalid unstaged source remains untouched", async () => {
  // Given: a valid staged hunk and a separated unstaged TeX error.
  await using fixture = await gitFixture({ compiler: true });
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const service = fixture.service();
  const scope = { projectId: project.id, branch: "main" };
  await service.patch(owner.user.id, { projectId: project.id, expectedVersion: service.getProject(project.id).version,
    settings: { ...project.settings, environmentId: nativeEnvironmentId } });
  const original = "\\documentclass{article}\n\\begin{document}\nOriginal text.\n"
    + Array.from({ length: 24 }, (_, i) => `% spacing ${i}\n`).join("") + "\\end{document}\n";
  await service.serialized(scope, () => service.commitSource({ actorId: owner.user.id, scope,
    expectedRevision: service.getBranch(scope).revision,
    inputs: service.listFiles(scope).map(file => ({ file, bytes: new TextEncoder().encode(original) })) }));
  await fixture.status(owner.headers, project.id);
  const changed = original.replace("Original text.", "Staged text.").replace("\\end{document}", "\\InvalidUnstagedCommand\n\\end{document}");
  await service.serialized(scope, () => service.commitSource({ actorId: owner.user.id, scope,
    expectedRevision: service.getBranch(scope).revision,
    inputs: service.listFiles(scope).map(file => ({ file, bytes: new TextEncoder().encode(changed) })) }));
  const status = await fixture.status(owner.headers, project.id);
  const first = status.hunks[0];
  if (!first) throw new TypeError("Expected stageable hunk");
  expect(status.hunks).toHaveLength(2);
  await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${status.revision}"` },
    body: JSON.stringify({ scope, head: status.head, hunkIds: [first.id], staged: true, expectedVersion: status.revision }) });
  // When: compileFirst commits only the selected valid tree.
  const response = await fixture.request(`/api/projects/${project.id}/git/commit`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, head: status.head, message: "Staged compile", compileFirst: true, expectedVersion: status.revision }) });
  // Then: the actual compiler succeeds on exactly the named tree and never overwrites live source.
  expect(response.status, JSON.stringify(fixture.failures)).toBe(202);
  const committed = await run({ path: repositoryPath(service.context, project.id), args: ["rev-parse", "main^{tree}"] });
  const compiled = z.object({ tree: z.string() }).parse(fixture.runtime.db.query(
    "SELECT s.tree FROM compile_jobs j JOIN snapshots s ON s.id=j.snapshot_id").get());
  expect(raw(compiled.tree)).toBe(committed.text);
  expect(service.readDocument(scope, project.settings.mainFileId).text).toBe(changed);
});
