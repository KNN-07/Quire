import { expect, test } from "bun:test";
import { sshFixture } from "./fixture";
import { join } from "node:path";

test("denies hidden object wants when a caller knows a real private checkpoint hash", async () => {
  // Given: a canonical repository with a private checkpoint and a named SSH root.
  await using fixture = await sshFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  await fixture.registerKey(owner.headers);
  const refs = await fixture.git(["ls-remote", fixture.url(project.id)]);
  expect(refs.code, refs.error).toBe(0);
  expect(refs.out).toContain("refs/heads/main");
  expect(refs.out).not.toContain("refs/quire/");
  const checkpoint = new TextDecoder().decode(await fixture.runtime.repositories.objects(project.id,
    ["for-each-ref", "--format=%(objectname)", "refs/quire/history/"])).trim().split("\n")[0];
  if (!checkpoint) throw new TypeError("Expected a private checkpoint, not a synthetic unknown hash");
  const work = join(fixture.root, "attacker");
  expect((await fixture.git(["init", work])).code).toBe(0);
  // When: Git asks for the known hidden object rather than an advertised named ref.
  const fetch = await fixture.git(["fetch", fixture.url(project.id), checkpoint], work);
  // Then: the private object is physically absent from the transport object store.
  expect(fetch.code).not.toBe(0);
  expect((await fixture.git(["cat-file", "-e", checkpoint], work)).code).not.toBe(0);
}, 60_000);

test.each(["id", "sh -c id", "git-upload-pack '/etc/passwd'", "git-upload-archive 'repo.git'"])(
  "denies arbitrary execution when an authenticated SSH key requests %s", async command => {
    // Given: an ordinary key accepted by the real SSH daemon.
    await using fixture = await sshFixture();
    const owner = await fixture.login();
    await fixture.registerKey(owner.headers);
    // When: a non-Git or path-bearing command reaches its forced command.
    const execution = await fixture.ssh([command]);
    // Then: no shell result or file bytes are returned.
    expect(execution.code).not.toBe(0);
    expect(execution.out).toBe("");
  }, 60_000);
