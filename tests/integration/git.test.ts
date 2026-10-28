import { test, expect } from "bun:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { gitFixture } from "../core/git/harness";
import { repositoryPath } from "../../services/core/base";
import { run } from "../../services/core/git/process";

async function cli(args: readonly string[], cwd: string) {
  const child = Bun.spawn(["git", "-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { out, error, code };
}

test("T11 real CLI clone fetch push materializes source and rejects revoked credentials", async () => {
  // Given: a real HTTP bridge, owner token and named initial commit.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const status = await fixture.status(owner.headers, project.id);
  const token = await fixture.token(owner.headers);
  const url = new URL(`/git/${project.id}.git`, fixture.server.url);
  url.username = "git";
  url.password = token.secretOnce;
  const work = join(fixture.path, "work");
  const cloned = await cli(["clone", url.toString(), work], fixture.path);
  expect(cloned.code, JSON.stringify(cloned)).toBe(0);
  const original = await readFile(join(work, "main.tex"), "utf8");
  await writeFile(join(work, "main.tex"), `${original}% local Git change\n`);
  await cli(["add", "main.tex"], work);
  const committed = await cli(["-c", "user.name=CLI Author", "-c", "user.email=cli@example.test", "commit", "-m", "CLI source"], work);
  expect(committed.code).toBe(0);
  // When: ordinary Git pushes then fetches from the smart HTTP server.
  const pushed = await cli(["push", "origin", "main"], work);
  const fetched = await cli(["fetch", "origin"], work);
  // Then: the server has real Git ancestry and browser bytes, and revocation blocks the next fetch.
  expect({ code: pushed.code, failures: pushed.code ? fixture.failures : [] }).toEqual({ code: 0, failures: [] });
  expect(fetched.code).toBe(0);
  expect((await fixture.service().readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId)).text)
    .toBe(`${original}% local Git change\n`);
  const head = await run({ path: repositoryPath(fixture.service().context, project.id), args: ["rev-parse", "main^"] });
  expect(`sha1:${head.text}`).toBe(status.head);
  const revoked = await fixture.request(`/api/me/git-tokens/${token.id}`, { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ expectedVersion: 0 }) });
  expect(revoked.status).toBe(200);
  expect((await cli(["fetch", "origin"], work)).code).not.toBe(0);
});

test("T11 quarantine rejects dirty-browser push without changing refs or running imported hooks", async () => {
  // Given: a clone, later browser edits, and a malicious repository hook.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const token = await fixture.token(owner.headers);
  const url = new URL(`/git/${project.id}.git`, fixture.server.url);
  url.username = "git"; url.password = token.secretOnce;
  const work = join(fixture.path, "work");
  expect((await cli(["clone", url.toString(), work], fixture.path)).code).toBe(0);
  const service = fixture.service();
  const scope = { projectId: project.id, branch: "main" };
  const original = (await service.readDocument(scope, project.settings.mainFileId)).text;
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope, expectedRevision: before.revision,
    inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(`${original}% browser\n`) })) }));
  const hookDir = join(repositoryPath(service.context, project.id), "hooks");
  await mkdir(hookDir, { recursive: true });
  const hook = join(hookDir, "pre-receive");
  await writeFile(hook, "#!/bin/sh\nexit 71\n", { mode: 0o700 });
  await writeFile(join(work, "main.tex"), `${original}% local\n`);
  await cli(["add", "."], work);
  await cli(["-c", "user.name=Local", "-c", "user.email=local@example.test", "commit", "-m", "Local"], work);
  // When: pushing into the dirty branch fails, but a new branch accepts the same object.
  const dirty = await cli(["push", "origin", "main"], work);
  const separate = await cli(["push", "origin", "HEAD:refs/heads/offline"], work);
  // Then: main remains untouched, a real alternate branch exists, and hooks were disabled.
  expect(dirty.code).not.toBe(0);
  expect(separate.code).toBe(0);
  const after = await fixture.status(owner.headers, project.id);
  expect(after.head).toBe(before.head);
  expect((await service.readDocument(scope, project.settings.mainFileId)).text).toBe(`${original}% browser\n`);
  expect((await service.readDocument({ ...scope, branch: "offline" }, project.settings.mainFileId)).text).toBe(`${original}% local\n`);
});

test("T11 fetch advertisement never leaks private checkpoint refs and current ACL is enforced", async () => {
  // Given: a project with actual private checkpoints and an authenticated bridge.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  await fixture.status(owner.headers, project.id);
  const token = await fixture.token(owner.headers);
  const url = new URL(`/git/${project.id}.git`, fixture.server.url);
  url.username = "git"; url.password = token.secretOnce;
  // When: Git lists advertised refs before and after project ownership access is revoked.
  const advertised = await cli(["ls-remote", url.toString()], fixture.path);
  const privateOid = (await run({ path: repositoryPath(fixture.service().context, project.id),
    args: ["for-each-ref", "--format=%(objectname)", "refs/quire/history/"] })).text.split("\n")[0];
  if (!privateOid) throw new TypeError("Expected a private checkpoint commit");
  const attacker = join(fixture.path, "fetch-private");
  expect((await cli(["init", attacker], fixture.path)).code).toBe(0);
  const hidden = await cli(["fetch", url.toString(), privateOid], attacker);
  const other = await fixture.login("alex@quire.local");
  await fixture.runtime.db.run("UPDATE projects SET owner_id=? WHERE id=?", [other.user.id, project.id]);
  const denied = await cli(["ls-remote", url.toString()], fixture.path);
  // Then: only named refs are visible and an old token cannot retain the old ACL.
  expect(advertised.code).toBe(0);
  expect(advertised.out, JSON.stringify(advertised)).toContain("refs/heads/main");
  expect(advertised.out).not.toContain("refs/quire/");
  expect(hidden.code).not.toBe(0);
  expect(denied.code).not.toBe(0);
  const listed = await fixture.request("/api/me/git-tokens", { headers: owner.headers });
  expect(z.object({ data: z.object({ items: z.array(z.object({ id: z.string() })) }) }).parse(await listed.json()).data.items).toHaveLength(1);
});
