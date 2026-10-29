import { test, expect } from "bun:test";
import { z } from "zod";
import { CompileJobSchema, IdSchema } from "@quire/contracts";
import { nativeEnvironmentId } from "../../../services/compiler";
import { gitFixture } from "./harness";
import { run, raw } from "../../../services/core/git/process";
import { repositoryPath } from "../../../services/core/base";

for (const saved of [true, false]) for (const valid of [true, false]) {
  test(`T11 real compiler ${valid ? "allows successful" : "blocks failed"} ${saved ? "saved preference with explicit false" : "per-commit opt-in"}`, async () => {
    // Given: an actual confined compiler, real source, and fully staged changes.
    await using fixture = await gitFixture({ compiler: true });
    const owner = await fixture.login();
    const project = await fixture.create(owner.headers);
    const preference = await fixture.request("/api/me/preferences", { method: "PATCH", headers: owner.headers,
      body: JSON.stringify({ compileBeforeCommit: saved, expectedVersion: 0 }) });
    expect(preference.status, await preference.clone().text()).toBe(200);
    const scope = { projectId: project.id, branch: "main" };
    const service = fixture.service();
    await service.patch(owner.user.id, { projectId: project.id, expectedVersion: (await service.getProject(project.id)).version,
      settings: { ...project.settings, environmentId: nativeEnvironmentId } });
    await fixture.status(owner.headers, project.id);
    const original = (await service.readDocument(scope, project.settings.mainFileId)).text;
    const changed = original.replace("\\end{document}", `${valid ? "Compiled Git source." : "\\QuireMissingCommand"}\n\\end{document}`);
    await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope,
      expectedRevision: (await service.getBranch(scope)).revision,
      inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(changed) })) }));
    const status = await fixture.status(owner.headers, project.id);
    const staged = await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
      headers: { ...owner.headers, "if-match": `"v${status.revision}"` },
      body: JSON.stringify({ scope, head: status.head, hunkIds: status.hunks.map(h => h.id), staged: true, expectedVersion: status.revision }) });
    expect(staged.status).toBe(200);
    // When: the authenticated HTTP commit runs the real compilation gate.
    const response = await fixture.request(`/api/projects/${project.id}/git/commit`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ scope, head: status.head, message: "Compiler gate", compileFirst: !saved, expectedVersion: status.revision }) });
    // Then: named history advances only for a successfully compiled exact source tree.
    expect(response.status, JSON.stringify(fixture.failures)).toBe(valid ? 202 : 409);
    const after = await fixture.status(owner.headers, project.id);
    expect(after.head === status.head).toBe(!valid);
    const rows = await fixture.runtime.db.all("SELECT id FROM compile_jobs");
    const jobId = z.array(z.object({ id: z.string() })).parse(rows)[0]?.id;
    if (!jobId) throw new TypeError("Expected real compile job");
    const result = await fixture.request(`/api/compiles/${jobId}`, { headers: owner.headers });
    const job = z.object({ data: CompileJobSchema }).parse(await result.json()).data;
    expect(job.status).toBe(valid ? "succeeded" : "failed");
    console.info("P61_BACKEND", JSON.stringify({ utc: new Date().toISOString(), origin: `http://${fixture.server.hostname}:${fixture.server.port}`,
      saved, valid, ownedRoot: fixture.path, projectId: project.id, requestCompileFirst: !saved, status: response.status,
      before: status.head, after: after.head, staged: after.staged, job }));
    if (!valid) expect(after.staged).toEqual(status.hunks.map(hunk => hunk.id));
    if (valid) {
      const committed = await run({ path: repositoryPath(service.context, project.id), args: ["rev-parse", "main^{tree}"] });
      expect(raw(job.snapshot.tree)).toBe(committed.text);
    }
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
  await service.patch(owner.user.id, { projectId: project.id, expectedVersion: (await service.getProject(project.id)).version,
    settings: { ...project.settings, environmentId: nativeEnvironmentId } });
  const original = "\\documentclass{article}\n\\begin{document}\nOriginal text.\n"
    + Array.from({ length: 24 }, (_, i) => `% spacing ${i}\n`).join("") + "\\end{document}\n";
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope,
    expectedRevision: (await service.getBranch(scope)).revision,
    inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(original) })) }));
  await fixture.status(owner.headers, project.id);
  const changed = original.replace("Original text.", "Staged text.").replace("\\end{document}", "\\InvalidUnstagedCommand\n\\end{document}");
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope,
    expectedRevision: (await service.getBranch(scope)).revision,
    inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(changed) })) }));
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
  const compiled = z.object({ tree: z.string() }).parse(await fixture.runtime.db.get(
    "SELECT s.tree FROM compile_jobs j JOIN snapshots s ON s.id=j.snapshot_id"));
  expect(raw(compiled.tree)).toBe(committed.text);
  expect((await service.readDocument(scope, project.settings.mainFileId)).text).toBe(changed);
  console.info("P61_STAGED", JSON.stringify({ ownedRoot: fixture.path, committedTree: committed.text, compiledTree: compiled.tree }));
});

test("T11 saved compile preference rejects source changed after gate admission", async () => {
  await using fixture = await gitFixture({ compiler: true });
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const service = fixture.service();
  await service.patch(owner.user.id, { projectId: project.id, expectedVersion: project.version,
    settings: { ...project.settings, environmentId: nativeEnvironmentId } });
  expect((await fixture.request("/api/me/preferences", { method: "PATCH", headers: owner.headers,
    body: JSON.stringify({ compileBeforeCommit: true, expectedVersion: 0 }) })).status).toBe(200);
  await fixture.status(owner.headers, project.id);
  const original = (await service.readDocument(scope, project.settings.mainFileId)).text;
  async function change(text: string) {
    await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope,
      expectedRevision: (await service.getBranch(scope)).revision,
      inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(text) })) }));
  }
  await change(original.replace("\\end{document}", "Staged race gate source.\n\\end{document}"));
  const before = await fixture.status(owner.headers, project.id);
  expect((await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${before.revision}"` },
    body: JSON.stringify({ scope, head: before.head, hunkIds: before.hunks.map(hunk => hunk.id),
      staged: true, expectedVersion: before.revision }) })).status).toBe(200);
  const compiler = fixture.runtime.services.get("compiler");
  const enqueue = compiler.enqueue.bind(compiler);
  // Complete a real source write before enqueue returns to the gate; the real compiler still runs.
  compiler.enqueue = async (...args) => {
    const job = await enqueue(...args);
    await change(original.replace("\\end{document}", "Source changed during compile.\n\\end{document}"));
    return job;
  };
  let response: Response;
  try {
    response = await fixture.request(`/api/projects/${project.id}/git/commit`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ scope, head: before.head, message: "Source race", compileFirst: false,
        expectedVersion: before.revision }) });
  } finally { compiler.enqueue = enqueue; }
  const body: unknown = await response.json();
  const jobs = z.array(z.object({ id: IdSchema })).parse(await fixture.runtime.db.all("SELECT id FROM compile_jobs"));
  for (const job of jobs) console.info("P61_RACE_JOB", JSON.stringify(await compiler.get(owner.user.id, job.id)));
  expect(response.status).toBe(409);
  expect(body).toMatchObject({ error: { code: "STALE_VERSION" } });
  expect((await fixture.status(owner.headers, project.id)).head).toBe(before.head);
  expect(await fixture.runtime.db.all("SELECT key FROM core_git_receipts")).toHaveLength(0);
  console.info("P61_RACE", JSON.stringify({ utc: new Date().toISOString(), ownedRoot: fixture.path,
    status: response.status, body, head: before.head }));
}, 120000);
