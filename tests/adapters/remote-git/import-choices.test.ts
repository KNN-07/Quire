import { expect, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { githubFixture } from "./provider-fixture";
import { remoteGitHarness } from "./harness";
import { migrations } from "../../../services/adapters/remote-git/migrations";

test.each([[true, true], [true, false], [false, false]] as const)(
  "remote import retains selected settings and explicit history/connection: %s %s", async (preserveHistory, keepConnected) => {
    await using provider = await githubFixture();
    const text = "\\documentclass{article}\n\\begin{document}Second remote revision\\end{document}\n";
    await provider.commit("owner/research", text, "Second revision");
    await using app = await remoteGitHarness(provider.origin, { interchange: true });
    await app.configure();
    const owner = await app.login();
    const grant = await app.connect(owner);
    const key = crypto.randomUUID();
    const body = {
      kind: "github", name: "Selected remote settings", mainPath: "main.tex",
      engine: "xelatex", environmentId: fixtureIds.environment, preserveHistory, keepConnected,
      source: { kind: "git", url: `${provider.origin}/owner/research.git`, branch: "main", grantId: grant.id },
    };
    const request = { method: "POST", headers: { ...owner.headers, "idempotency-key": key }, body: JSON.stringify(body) };
    const response = await app.request("/api/imports", request);
    expect(response.status).toBe(202);
    const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
    const result = z.object({ projectId: IdSchema, bindingId: IdSchema.nullable(),
      preserveHistory: z.boolean(), keepConnected: z.boolean(), branches: z.array(z.string()), tags: z.array(z.string()),
    }).parse(operation.result);
    const project = await app.projects.getProject(result.projectId);
    expect(project.settings).toMatchObject({ engine: "xelatex", environmentId: fixtureIds.environment });
    const document = await app.projects.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId);
    expect(document.file.path).toBe("main.tex");
    expect(document.text).toBe(text);
    const history = new TextDecoder().decode(await app.runtime.repositories.read(project.id,
      ["log", "--format=%H", "refs/heads/main"])).trim().split("\n");
    expect(history).toHaveLength(preserveHistory ? 2 : 1);
    expect(result.branches.sort()).toEqual(preserveHistory ? ["main", "protected/release"] : ["main"]);
    expect(result.tags).toEqual(preserveHistory ? ["v1.0.0"] : []);
    const binding = await app.runtime.db.get("SELECT id FROM remote_bindings WHERE project_id=?", [project.id]);
    if (keepConnected) expect(binding).toMatchObject({ id: result.bindingId });
    else { expect(binding).toBeNull(); expect(result.bindingId).toBeNull(); }
    await app.restart();
    const replay = await app.request("/api/imports", request);
    expect(replay.status).toBe(202);
    expect(z.object({ data: OperationSchema }).parse(await replay.json()).data).toEqual(operation);
    expect(await app.runtime.db.all("SELECT id FROM projects WHERE name=?", [body.name])).toHaveLength(1);
    expect((await app.projects.getProject(project.id)).settings).toEqual(project.settings);
    if (!preserveHistory) {
      await app.runtime.db.run("UPDATE adapter_cursors SET cursor='legacy-import-cursor' WHERE grant_id=? AND action='import' AND project_id=''", [grant.id]);
      const migration = migrations.find(item => item.id === "062-x-remote-independent-import-cursors");
      if (!migration) throw new Error("Import cursor migration required");
      await app.runtime.db.run(migration.sql);
      expect(await app.runtime.db.get("SELECT cursor FROM adapter_cursors WHERE grant_id=? AND action='import' AND project_id=''", [grant.id]))
        .toEqual({ cursor: null });
    }
    const another = await app.request("/api/imports", { ...request,
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ ...body, name: "Another import with the same connection" }),
    });
    expect(another.status).toBe(202);
    const anotherOperation = z.object({ data: OperationSchema }).parse(await another.json()).data;
    expect(anotherOperation.result?.["projectId"]).not.toBe(project.id);
    console.info("P69_IMPORT", { root: app.path, preserveHistory, keepConnected, project, operation, history });
  }, 120_000);

test("remote import rejects incompatible settings before project repository publication", async () => {
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin, { interchange: true });
  await app.configure();
  const owner = await app.login();
  const grant = await app.connect(owner);
  const directories = (await readdir(join(app.path, "git"))).sort();
  const publications = await app.runtime.db.all("SELECT id FROM repository_intents ORDER BY id");
  for (const [selection, code] of [
    [{ mainPath: "missing.tex" }, "INVALID_MAIN"],
    [{ engine: "plain" }, "ENGINE_UNAVAILABLE"],
    [{ preserveHistory: false, keepConnected: true }, "REMOTE_HISTORY_REQUIRED"],
  ] as const) {
    const response = await app.request("/api/imports", { method: "POST",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ kind: "github", name: "Rejected choices", environmentId: fixtureIds.environment,
        ...selection, source: { kind: "git", url: `${provider.origin}/owner/research.git`, branch: "main", grantId: grant.id } }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(await app.runtime.db.all("SELECT id FROM projects WHERE name='Rejected choices'")).toHaveLength(0);
    expect((await readdir(join(app.path, "git"))).sort()).toEqual(directories);
    expect(await app.runtime.db.all("SELECT id FROM repository_intents ORDER BY id")).toEqual(publications);
  }
}, 120_000);

test("recovers a disconnected snapshot import without creating a remote binding", async () => {
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin, { interchange: true });
  await app.configure();
  const owner = await app.login();
  const grant = await app.connect(owner);
  const key = crypto.randomUUID();
  const record = app.runtime.events.record.bind(app.runtime.events);
  let injected = false;
  const fault = spyOn(app.runtime.events, "record").mockImplementation(async (tx, event) => {
    if (!injected && event.topic === "tree.changed") { injected = true; throw new Error("Interrupted snapshot publication"); }
    return record(tx, event);
  });
  const request = { method: "POST", headers: { ...owner.headers, "idempotency-key": key },
    body: JSON.stringify({ kind: "github", name: "Recovered independent snapshot", engine: "xelatex",
      preserveHistory: false, keepConnected: false, source: {
        kind: "git", url: `${provider.origin}/owner/research.git`, branch: "main", grantId: grant.id,
      } }),
  };
  try { expect((await app.request("/api/imports", request)).status).toBe(502); }
  finally { fault.mockRestore(); }
  await app.restart();
  const response = await app.request("/api/imports", request);
  expect(response.status).toBe(202);
  const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
  const projectId = IdSchema.parse(operation.result?.["projectId"]);
  expect(operation.status).toBe("succeeded");
  expect((await app.projects.getProject(projectId)).settings.engine).toBe("xelatex");
  expect(await app.runtime.db.get("SELECT id FROM remote_bindings WHERE project_id=?", [projectId])).toBeNull();
  expect(await app.runtime.db.all("SELECT id FROM remote_git_intents")).toHaveLength(0);
  const commits = new TextDecoder().decode(await app.runtime.repositories.read(projectId,
    ["log", "--format=%H", "refs/heads/main"])).trim().split("\n");
  expect(commits).toHaveLength(1);
}, 120_000);
