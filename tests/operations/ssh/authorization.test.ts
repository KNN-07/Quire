import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sshFixture } from "./fixture";

test.each(["viewer", "reviewer"])("denies push but permits clone when the current role is %s", async role => {
  // Given: an actual key belonging to a named read-only collaborator.
  await using fixture = await sshFixture();
  const owner = await fixture.login();
  const reader = await fixture.login("alex@quire.local");
  const project = await fixture.create(owner.headers);
  await fixture.runtime.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,?,?)",
      [crypto.randomUUID(), project.id, reader.user.id, role, fixture.runtime.clock.now()]);
  });
  await fixture.registerKey(reader.headers);
  const work = join(fixture.root, "reader");
  const clone = await fixture.git(["clone", fixture.url(project.id), work]);
  expect(clone.code, clone.error).toBe(0);
  await writeFile(join(work, "unauthorized.tex"), "denied\n");
  expect((await fixture.git(["add", "."], work)).code).toBe(0);
  expect((await fixture.git(["-c", "user.name=Reader", "-c", "user.email=reader@example.test",
    "commit", "-m", "Read-only push"], work)).code).toBe(0);
  // When: this authenticated read-only key requests receive-pack.
  const push = await fixture.git(["push", "origin", "main"], work);
  // Then: no unprivileged source is published.
  expect(push.code).not.toBe(0);
  expect((await fixture.projects.listFiles({ projectId: project.id, branch: "main" }))
    .some(file => file.path === "unauthorized.tex")).toBe(false);
}, 60_000);

test("denies a new fetch when the account key has been revoked through the current API", async () => {
  // Given: a real key that has authenticated successfully, then was revoked by its owner.
  await using fixture = await sshFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const key = await fixture.registerKey(owner.headers);
  expect((await fixture.git(["ls-remote", fixture.url(project.id)])).code).toBe(0);
  const removed = await fixture.request(`/api/me/ssh-keys/${key.id}`, { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ expectedVersion: key.version }) });
  expect(removed.status).toBe(200);
  // When: an ordinary SSH Git client reuses its still-present private key.
  const fetch = await fixture.git(["ls-remote", fixture.url(project.id)]);
  // Then: key possession cannot retain revoked account authority.
  expect(fetch.code).not.toBe(0);
}, 60_000);

test("denies a new fetch when a still-registered key loses project access", async () => {
  // Given: a real key whose owner lost the original project's ownership.
  await using fixture = await sshFixture();
  const owner = await fixture.login();
  const other = await fixture.login("alex@quire.local");
  const project = await fixture.create(owner.headers);
  await fixture.registerKey(owner.headers);
  expect((await fixture.git(["ls-remote", fixture.url(project.id)])).code).toBe(0);
  await fixture.runtime.db.run("UPDATE projects SET owner_id=? WHERE id=?", [other.user.id, project.id]);
  // When: the old key asks to enumerate the same repository again.
  const fetch = await fixture.git(["ls-remote", fixture.url(project.id)]);
  // Then: authorization uses the current ACL rather than key-time membership.
  expect(fetch.code).not.toBe(0);
  expect(fetch.out).toBe("");
}, 60_000);

test("denies a new fetch when a key's account is suspended", async () => {
  // Given: a stored SSH key with a currently suspended user.
  await using fixture = await sshFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  await fixture.registerKey(owner.headers);
  await fixture.runtime.db.run("UPDATE users SET suspended=1 WHERE id=?", [owner.user.id]);
  // When: the signed SSH client attempts repository access.
  const fetch = await fixture.git(["ls-remote", fixture.url(project.id)]);
  // Then: account suspension applies before any refs are advertised.
  expect(fetch.code).not.toBe(0);
  expect(fetch.out).toBe("");
}, 60_000);
