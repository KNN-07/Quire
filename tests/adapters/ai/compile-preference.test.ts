import { expect, test } from "bun:test";
import { z } from "zod";
import { DigestSchema } from "@quire/contracts";
import type { Id, Scope } from "@quire/contracts";
import { nativeEnvironmentId } from "../../../services/compiler";
import { GitRepository } from "../../../services/core/git";
import { raw } from "../../../services/core/git/process";
import { aiFixture, failure } from "./harness";
import { providerServer } from "./provider";

const compiledRow = z.object({ id: z.string(), status: z.string(), tree: z.string() });

async function printableSource(fixture: Awaited<ReturnType<typeof aiFixture>>, actorId: Id, scope: Scope, fileId: Id) {
  // A blank project has no pages: actual latexmk requires printable content to emit a PDF.
  const original = await fixture.core.readDocument(scope, fileId);
  await fixture.core.serialized(scope, async lease => fixture.core.commitSource({ actorId, scope, lease,
    expectedRevision: (await fixture.core.getBranch(scope)).revision,
    inputs: [{ file: original.file, bytes: new TextEncoder().encode(
      original.text.replace("\\begin{document}", "\\begin{document}\nPrintable compiler fixture.")) }] }));
}

for (const newBranch of [false, true]) for (const valid of [false, true]) {
  test(`P61 AI saved preference ${valid ? "compiles" : "blocks"} exact reviewed tree (newBranch=${newBranch})`, async () => {
    await using provider = providerServer();
    await using fixture = await aiFixture(provider.origin, { compiler: true });
    const session = await fixture.login();
    await fixture.configure();
    const project = await fixture.project(session);
    const scope = { projectId: project.id, branch: project.defaultBranch };
    await fixture.core.patch(session.user.id, { projectId: project.id, expectedVersion: project.version,
      settings: { ...project.settings, environmentId: nativeEnvironmentId } });
    await printableSource(fixture, session.user.id, scope, project.settings.mainFileId);
    expect((await fixture.request("/api/me/preferences", { method: "PATCH", headers: session.headers,
      body: JSON.stringify({ compileBeforeCommit: true, expectedVersion: 0 }) })).status).toBe(200);
    const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
    const repo = new GitRepository(fixture.core);
    const before = await fixture.core.serialized(scope, lease => repo.inspect(session.user.id, scope, lease));
    const insertion = valid ? "% reviewed compile\n" : "\\QuireMissingCommand\n";
    provider.respond(context => ({ text: "Reviewed edit", citations: [], patches: context.files.map(file =>
      ({ fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: insertion })) }));
    const run = await fixture.run(session, { scope, mode: "agent", tool: "texgpt", prompt: "Insert",
      fileIds: [original.file.id] });
    const input = { id: run.id, editIds: [], decision: "accept" as const, commit: true,
      ...(newBranch ? { newBranch: "ai/compiled" } : {}),
      expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() };
    if (valid) {
      const accepted = await fixture.ai.decisions.decide(session.actor, input).catch(async error => {
        console.error("P61_AI_COMPILE_FAILURE", JSON.stringify(await fixture.runtime.db.all("SELECT * FROM compile_jobs")));
        const artifacts = await fixture.runtime.db.all<{ sha256: string; name: string }>("SELECT sha256,name FROM artifacts");
        for (const artifact of artifacts) if (artifact.name.endsWith(".log")) {
          console.error(artifact.name, new TextDecoder().decode(await fixture.core.context.blobs.get(DigestSchema.parse(artifact.sha256))));
        }
        throw error;
      });
      expect(accepted.proposals[0]?.edits[0]?.status).toBe("accepted");
      // A replay must not sample changed preferences, compile, or publish another decision.
      expect((await fixture.request("/api/me/preferences", { method: "PATCH", headers: session.headers,
        body: JSON.stringify({ compileBeforeCommit: false, expectedVersion: 1 }) })).status).toBe(200);
      expect(await fixture.ai.decisions.decide(session.actor, input)).toEqual(accepted);
    } else {
      expect((await failure(fixture.ai.decisions.decide(session.actor, input))).code).toBe("COMPILE_REQUIRED");
      expect((await fixture.ai.get(session.actor, run.id)).version).toBe(input.expectedVersion);
      expect((await fixture.ai.get(session.actor, run.id)).run.proposals[0]?.edits[0]?.status).toBe("pending");
      expect(await fixture.runtime.db.get("SELECT 1 FROM ai_source_journal WHERE run_id=?", [run.id])).toBeNull();
      expect(await fixture.runtime.db.get("SELECT 1 FROM idempotency_results WHERE key=?", [input.key])).toBeNull();
      if (newBranch) expect(await fixture.runtime.db.get(
        "SELECT 1 FROM branch_workspaces WHERE project_id=? AND branch='ai/compiled'", [project.id])).toBeNull();
    }
    const jobs = z.array(compiledRow).parse(await fixture.runtime.db.all(
      "SELECT j.id,j.status,s.tree FROM compile_jobs j JOIN snapshots s ON s.id=j.snapshot_id"));
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    if (!job) throw new TypeError("Expected real compile");
    expect(job.status).toBe(valid ? "succeeded" : "failed");
    const target = { ...scope, branch: newBranch ? "ai/compiled" : scope.branch };
    const after = await fixture.core.serialized(scope, lease => repo.inspect(session.user.id, scope, lease));
    expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(valid && !newBranch ? insertion + original.text : original.text);
    if (valid) {
      const committed = new TextDecoder().decode(await fixture.runtime.repositories.read(project.id,
        ["rev-parse", `refs/heads/${target.branch}^{tree}`])).trim();
      expect(committed).toBe(raw(job.tree));
      expect((await fixture.core.readDocument(target, original.file.id)).text).toBe(insertion + original.text);
      if (newBranch) expect(after.head).toBe(before.head);
    } else expect(after.head).toBe(before.head);
    console.info("P61_AI_COMPILE", JSON.stringify({ ownedRoot: fixture.path, projectId: project.id,
      valid, newBranch, before: before.head, after: after.head, job }));
  }, 120000);
}

test.each([{ saved: false, commit: true }, { saved: true, commit: false }])(
  "P61 AI preserves ungated behavior saved=$saved commit=$commit", async ({ saved, commit }) => {
    await using provider = providerServer();
    await using fixture = await aiFixture(provider.origin);
    const session = await fixture.login();
    await fixture.configure();
    const project = await fixture.project(session);
    const scope = { projectId: project.id, branch: project.defaultBranch };
    if (saved) expect((await fixture.request("/api/me/preferences", { method: "PATCH", headers: session.headers,
      body: JSON.stringify({ compileBeforeCommit: true, expectedVersion: 0 }) })).status).toBe(200);
    provider.respond(context => ({ text: "Invalid TeX", citations: [], patches: context.files.map(file =>
      ({ fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "\\QuireMissingCommand\n" })) }));
    const run = await fixture.run(session, { scope, mode: "agent", tool: "texgpt", prompt: "Insert",
      fileIds: [project.settings.mainFileId] });
    const accepted = await fixture.ai.decisions.decide(session.actor, { id: run.id, editIds: [], decision: "accept", commit,
      expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() });
    expect(accepted.proposals[0]?.edits[0]?.status).toBe("accepted");
  });

test.each([true, false])("P61 AI undo commit gates compilation (valid=%s)", async valid => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin, { compiler: true });
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  await fixture.core.patch(session.user.id, { projectId: project.id, expectedVersion: project.version,
    settings: { ...project.settings, environmentId: nativeEnvironmentId } });
  await printableSource(fixture, session.user.id, scope, project.settings.mainFileId);
  if (!valid) {
    const document = await fixture.core.readDocument(scope, project.settings.mainFileId);
    await fixture.core.serialized(scope, async lease => fixture.core.commitSource({ actorId: session.user.id, scope, lease,
      expectedRevision: (await fixture.core.getBranch(scope)).revision,
      inputs: [{ file: document.file, bytes: new TextEncoder().encode("\\QuireMissingCommand\n" + document.text) }] }));
  }
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(context => ({ text: "Insert", citations: [], patches: context.files.map(file =>
    ({ fileId: file.id, path: file.path, from: 0, to: file.text.length, before: file.text,
      after: valid ? "% accepted\n" + file.text : file.text.replace("\\QuireMissingCommand\n", "") })) }));
  const run = await fixture.run(session, { scope, mode: "agent", tool: "texgpt", prompt: "Insert", fileIds: [original.file.id] });
  await fixture.ai.decisions.decide(session.actor, { id: run.id, editIds: [], decision: "accept", commit: true,
    expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() });
  expect((await fixture.request("/api/me/preferences", { method: "PATCH", headers: session.headers,
    body: JSON.stringify({ compileBeforeCommit: true, expectedVersion: 0 }) })).status).toBe(200);
  const input = { id: run.id, editIds: [], decision: "undo" as const, commit: true,
    expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() };
  const beforeUndo = await fixture.core.readDocument(scope, original.file.id);
  const headBeforeUndo = new TextDecoder().decode(await fixture.runtime.repositories.read(project.id, ["rev-parse", "main"])).trim();
  if (valid) {
    const undone = await fixture.ai.decisions.decide(session.actor, input);
    expect(await fixture.ai.decisions.decide(session.actor, input)).toEqual(undone);
    expect(undone.proposals[0]?.edits[0]?.status).toBe("rejected");
    expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(original.text);
  } else {
    expect((await failure(fixture.ai.decisions.decide(session.actor, input))).code).toBe("COMPILE_REQUIRED");
    expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(beforeUndo.text);
    expect((await fixture.ai.get(session.actor, run.id)).run.proposals[0]?.edits[0]?.status).toBe("accepted");
    expect(new TextDecoder().decode(await fixture.runtime.repositories.read(project.id, ["rev-parse", "main"])).trim()).toBe(headBeforeUndo);
  }
  const jobs = z.array(compiledRow).parse(await fixture.runtime.db.all(
    "SELECT j.id,j.status,s.tree FROM compile_jobs j JOIN snapshots s ON s.id=j.snapshot_id"));
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.status).toBe(valid ? "succeeded" : "failed");
  const committed = new TextDecoder().decode(await fixture.runtime.repositories.read(project.id, ["rev-parse", "main^{tree}"])).trim();
  if (valid) expect(committed).toBe(raw(jobs[0]?.tree ?? ""));
  console.info("P61_AI_UNDO", JSON.stringify({ ownedRoot: fixture.path, valid, jobs, committed }));
}, 120000);

test.each(["source", "settings", "authority", "version"] as const)(
  "P61 AI revalidates %s after real compilation without holding either branch lease", async change => {
    await using provider = providerServer();
    await using fixture = await aiFixture(provider.origin, { compiler: true });
    const session = await fixture.login();
    await fixture.configure();
    const project = await fixture.project(session);
    const scope = { projectId: project.id, branch: project.defaultBranch };
    await fixture.core.patch(session.user.id, { projectId: project.id, expectedVersion: project.version,
      settings: { ...project.settings, environmentId: nativeEnvironmentId } });
    await printableSource(fixture, session.user.id, scope, project.settings.mainFileId);
    expect((await fixture.request("/api/me/preferences", { method: "PATCH", headers: session.headers,
      body: JSON.stringify({ compileBeforeCommit: true, expectedVersion: 0 }) })).status).toBe(200);
    const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
    const repo = new GitRepository(fixture.core);
    const before = await fixture.core.serialized(scope, lease => repo.inspect(session.user.id, scope, lease));
    provider.respond(context => ({ text: "Insert", citations: [], patches: context.files.map(file =>
      ({ fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% candidate\n" })) }));
    const run = await fixture.run(session, { scope, mode: "agent", tool: "texgpt", prompt: "Insert", fileIds: [original.file.id] });
    const input = { id: run.id, editIds: [], decision: "accept" as const, commit: true, newBranch: "ai/racing",
      expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() };
    const compiler = fixture.runtime.services.get("compiler");
    const enqueue = compiler.enqueue.bind(compiler);
    let acquired = false;
    compiler.enqueue = async (...args) => {
      const job = await enqueue(...args);
      // This exact boundary is after private hydration and before gate completion.
      // Both leases must be available, and an original-branch source write must not queue behind the gate.
      await fixture.core.serialized(scope, async lease => {
        const targetLease = await fixture.core.context.branches.acquire({ ...scope, branch: "ai/racing" }, crypto.randomUUID(), 60_000);
        expect(targetLease).not.toBeNull();
        if (targetLease) await fixture.core.context.branches.release(targetLease);
        acquired = true;
        if (change === "source") await fixture.core.commitSource({ actorId: session.user.id, scope, lease,
          expectedRevision: (await fixture.core.getBranch(scope)).revision,
          inputs: (await fixture.core.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode("% concurrent\n" + original.text) })) });
      });
      if (change === "settings") {
        const current = await fixture.core.getProject(project.id);
        await fixture.core.patch(session.user.id, { projectId: project.id, expectedVersion: current.version,
          settings: { ...current.settings, engine: "xelatex" } });
      }
      if (change === "authority") await fixture.ai.store.setSecurity(session.actor, { scope, confidential: true, expectedVersion: 0 });
      if (change === "version") await fixture.ai.decisions.decide(session.actor, { ...input, commit: false,
        newBranch: undefined, decision: "reject", key: crypto.randomUUID() });
      return job;
    };
    try {
      const error = await failure(fixture.ai.decisions.decide(session.actor, input));
      expect(error.code).toBe(change === "authority" ? "AI_CONFIDENTIAL" : change === "version" ? "VERSION_CONFLICT" : "COMPILE_TREE_MISMATCH");
    } finally { compiler.enqueue = enqueue; }
    expect(acquired).toBe(true);
    expect(await fixture.runtime.db.get("SELECT 1 FROM ai_source_journal WHERE run_id=?", [run.id])).toBeNull();
    expect(await fixture.runtime.db.get("SELECT 1 FROM idempotency_results WHERE key=?", [input.key])).toBeNull();
    expect(await fixture.runtime.db.get(
      "SELECT 1 FROM branch_workspaces WHERE project_id=? AND branch='ai/racing'", [project.id])).toBeNull();
    const head = new TextDecoder().decode(await fixture.runtime.repositories.read(project.id, ["rev-parse", "refs/heads/main"])).trim();
    expect(head).toBe(before.head);
    expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(change === "source" ? "% concurrent\n" + original.text : original.text);
    const jobs = z.array(compiledRow).parse(await fixture.runtime.db.all(
      "SELECT j.id,j.status,s.tree FROM compile_jobs j JOIN snapshots s ON s.id=j.snapshot_id"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("succeeded");
    console.info("P61_AI_RACE", JSON.stringify({ ownedRoot: fixture.path, change, acquired, jobs }));
  }, 120000);
