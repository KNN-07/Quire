import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sshFixture } from "./fixture";
import { bounded } from "./commands";

test("rejects canonical publication when the key is revoked after quarantine receives a real push", async () => {
  // Given: a real receive-pack completion barrier, subscribed before the push starts.
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let hold = false;
  await using fixture = await sshFixture(false, async () => {
    if (hold) { received.resolve(); await bounded(release.promise); }
  });
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const key = await fixture.registerKey(owner.headers);
  const work = join(fixture.root, "revoked-push");
  expect((await fixture.git(["clone", fixture.url(project.id), work])).code).toBe(0);
  const before = await fixture.git(["rev-parse", "HEAD"], work);
  await writeFile(join(work, "revoked.tex"), "never publish\n");
  expect((await fixture.git(["add", "."], work)).code).toBe(0);
  expect((await fixture.git(["-c", "user.name=Revoked", "-c", "user.email=revoked@example.test",
    "commit", "-m", "In-flight revocation"], work)).code).toBe(0);
  hold = true;
  // When: a real SSH push finishes quarantine, then its key is revoked before publication.
  const pushing = fixture.git(["push", "origin", "main"], work);
  try {
    await bounded(received.promise);
    const revoke = await fixture.request(`/api/me/ssh-keys/${key.id}`, { method: "DELETE", headers: owner.headers,
      body: JSON.stringify({ expectedVersion: key.version }) });
    expect(revoke.status).toBe(200);
  } finally { release.resolve(); }
  const pushed = await pushing;
  // Then: no successful Git report-status or canonical mutation escapes the revoked session.
  expect(pushed.code).not.toBe(0);
  expect(new TextDecoder().decode(await fixture.runtime.repositories.read(project.id,
    ["rev-parse", "refs/heads/main"])).trim()).toBe(before.out);
  expect((await fixture.projects.listFiles({ projectId: project.id, branch: "main" }))
    .some(file => file.path === "revoked.tex")).toBe(false);
}, 60_000);

test("rejects a dirty browser branch when an SSH push would overwrite its current source", async () => {
  // Given: a clean named clone followed by distinct durable browser and Git changes.
  await using fixture = await sshFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  await fixture.registerKey(owner.headers);
  const work = join(fixture.root, "dirty-push");
  expect((await fixture.git(["clone", fixture.url(project.id), work])).code).toBe(0);
  const original = await readFile(join(work, "main.tex"), "utf8");
  const before = await fixture.git(["rev-parse", "HEAD"], work);
  const scope = { projectId: project.id, branch: "main" };
  await fixture.projects.serialized(scope, async lease => fixture.projects.commitSource({
    lease, actorId: owner.user.id, scope,
    expectedRevision: (await fixture.projects.getBranch(scope)).revision,
    inputs: (await fixture.projects.listFiles(scope)).map(file => ({ file,
      bytes: new TextEncoder().encode(`${original}% browser survives\n`) })),
  }));
  await writeFile(join(work, "main.tex"), `${original}% conflicting SSH edit\n`);
  expect((await fixture.git(["add", "."], work)).code).toBe(0);
  expect((await fixture.git(["-c", "user.name=Offline", "-c", "user.email=offline@example.test",
    "commit", "-m", "Dirty browser conflict"], work)).code).toBe(0);
  // When: the real SSH client pushes into the dirty default branch.
  const pushed = await fixture.git(["push", "origin", "main"], work);
  // Then: canonical named ancestry and durable browser source retain their original authority.
  expect(pushed.code).not.toBe(0);
  expect(new TextDecoder().decode(await fixture.runtime.repositories.read(project.id,
    ["rev-parse", "refs/heads/main"])).trim()).toBe(before.out);
  expect((await fixture.projects.readDocument(scope, project.settings.mainFileId)).text).toBe(`${original}% browser survives\n`);
}, 60_000);

test("rejects nonbranch publication when a real SSH client pushes a tag", async () => {
  // Given: a named clone with a locally created tag.
  await using fixture = await sshFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  await fixture.registerKey(owner.headers);
  const work = join(fixture.root, "tag-push");
  expect((await fixture.git(["clone", fixture.url(project.id), work])).code).toBe(0);
  expect((await fixture.git(["tag", "forbidden-tag"], work)).code).toBe(0);
  // When: receive-pack accepts the tag in quarantine but core publication checks its ref.
  const pushed = await fixture.git(["push", "origin", "refs/tags/forbidden-tag"], work);
  // Then: the SSH client sees failure and no tag enters the canonical repository.
  expect(pushed.code).not.toBe(0);
  expect(new TextDecoder().decode(await fixture.runtime.repositories.read(project.id,
    ["for-each-ref", "--format=%(refname)", "refs/tags/"])).trim()).toBe("");
}, 60_000);
