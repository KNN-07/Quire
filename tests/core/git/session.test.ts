import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Id } from "@quire/contracts";
import { GitRepository, serveGitSession } from "../../../services/core/git";
import { run } from "../../../services/core/git/process";
import { gitFixture } from "./harness";

type Fixture = Awaited<ReturnType<typeof gitFixture>>;

test("SSH admission covers the protocol callback through temporary repository cleanup", async () => {
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const repo = new GitRepository(fixture.service());
  const fingerprint = await addSshKey(fixture, owner.user.id);
  const entered = Promise.withResolvers<string>();
  const release = Promise.withResolvers<void>();
  const deadline = setTimeout(() => {
    entered.reject(new Error("SSH callback did not enter"));
    release.resolve();
  }, 15000);
  const session = serveGitSession(repo, {
    fingerprint, projectId: project.id, service: "git-upload-pack",
    run: async path => {
      entered.resolve(path);
      await release.promise;
      const nested = await fixture.runtime.admission.exclusive(async () => {})
        .then(() => null, (error: unknown) => error);
      expect(nested).toMatchObject({ code: "BACKUP_REENTRANT" });
    },
  });
  try {
    const path = await entered.promise;
    const maintenance = fixture.runtime.admission.exclusive(async () => {
      expect(await Bun.file(join(path, "HEAD")).exists()).toBe(false);
    });
    release.resolve();
    await Promise.all([session, maintenance]);
  } finally {
    clearTimeout(deadline);
    release.resolve();
    await session;
  }
}, 30000);

async function addSshKey(fixture: Fixture, actorId: Id): Promise<string> {
  const fingerprint = `SHA256:${crypto.randomUUID().replaceAll("-", "").padEnd(43, "A")}`;
  await fixture.runtime.db.run(
    "INSERT INTO ssh_keys(id,user_id,name,public_key,fingerprint,created_at) VALUES(?,?,?,?,?,?)",
    [crypto.randomUUID(), actorId, "Session key", "ssh-ed25519 AAAA session", fingerprint, fixture.runtime.clock.now()],
  );
  return fingerprint;
}

async function cloneSession(input: {
  readonly repo: GitRepository;
  readonly fingerprint: string;
  readonly projectId: Id;
  readonly checkout: string;
}): Promise<void> {
  await serveGitSession(input.repo, {
    fingerprint: input.fingerprint,
    projectId: input.projectId,
    service: "git-upload-pack",
    run: async path => {
      await run({ args: ["clone", path, input.checkout] });
      await run({ args: ["-C", input.checkout, "fetch", "origin"] });
    },
  });
}

async function commitCheckout(path: string, text: string): Promise<string> {
  await writeFile(join(path, "main.tex"), text);
  await run({ args: ["-C", path, "config", "user.name", "SSH Test"] });
  await run({ args: ["-C", path, "config", "user.email", "ssh-test@quire.local"] });
  await run({ args: ["-C", path, "add", "main.tex"] });
  await run({ args: ["-C", path, "commit", "-m", "SSH push"] });
  return (await run({ args: ["-C", path, "rev-parse", "HEAD"] })).text;
}

test("SSH session clones and fetches finalized named ancestry without hidden objects", async () => {
  // Given: a current SSH key and a project with finalized named and private checkpoint history.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const repo = new GitRepository(fixture.service());
  const fingerprint = await addSshKey(fixture, owner.user.id);
  const hidden = (await run({ path: repo.path({ projectId: project.id, branch: "main" }),
    args: ["for-each-ref", "--format=%(objectname)", "refs/quire/history/"] })).text.split("\n")[0];
  if (!hidden) throw new TypeError("Expected private checkpoint history");
  const checkout = join(fixture.path, "ssh-clone");

  // When: the callback drives real clone and fetch commands against the temporary public repository.
  await cloneSession({ repo, fingerprint, projectId: project.id, checkout });

  // Then: the named head is usable while the private checkpoint object is absent.
  expect((await run({ args: ["-C", checkout, "rev-parse", "HEAD"] })).text).toBe(before.head.replace("sha1:", ""));
  expect((await run({ path: join(checkout, ".git"), args: ["cat-file", "-e", hidden], allowed: [0, 1, 128] })).code).not.toBe(0);
});

test("SSH session publishes a real push and rejects a subsequently revoked key", async () => {
  // Given: a current SSH key, a real checkout, and a new commit.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const repo = new GitRepository(fixture.service());
  const fingerprint = await addSshKey(fixture, owner.user.id);
  const checkout = join(fixture.path, "ssh-push");
  await cloneSession({ repo, fingerprint, projectId: project.id, checkout });
  const text = "\\documentclass{article}\n% ssh push\n";
  const after = await commitCheckout(checkout, text);

  // When: receive-pack updates the quarantine and the session returns after fenced publication.
  await serveGitSession(repo, {
    fingerprint,
    projectId: project.id,
    service: "git-receive-pack",
    run: async path => {
      await run({ args: ["-C", checkout, "push", path, "HEAD:refs/heads/main"] });
    },
  });
  await fixture.runtime.db.run("DELETE FROM ssh_keys WHERE fingerprint=?", [fingerprint]);
  let ran = false;
  const revoked = await serveGitSession(repo, {
    fingerprint,
    projectId: project.id,
    service: "git-upload-pack",
    run: async () => { ran = true; },
  }).then(() => null, (error: unknown) => error);

  // Then: named Git and browser source advance together, and revocation prevents another callback.
  expect((await fixture.status(owner.headers, project.id)).head).toBe(`sha1:${after}`);
  expect((await fixture.service().readDocument({ projectId: project.id, branch: "main" },
    project.settings.mainFileId)).text).toBe(text);
  expect(revoked).toMatchObject({ code: "GIT_AUTH_REQUIRED" });
  expect(ran).toBeFalse();
});

test("SSH key revocation after repository CAS prevents named finalization", async () => {
  // Given: a current SSH push whose repository publication hook revokes the exact key after CAS.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const repo = new GitRepository(fixture.service());
  const fingerprint = await addSshKey(fixture, owner.user.id);
  const checkout = join(fixture.path, "ssh-revoked-cas");
  await cloneSession({ repo, fingerprint, projectId: project.id, checkout });
  await commitCheckout(checkout, "\\documentclass{article}\n% revoked after CAS\n");
  const publish = fixture.runtime.repositories.publish.bind(fixture.runtime.repositories);
  fixture.runtime.repositories.publish = async intent => {
    await publish(intent);
    if (intent.updates.some(update => update.ref.startsWith("refs/heads/"))) {
      await fixture.runtime.db.run("DELETE FROM ssh_keys WHERE fingerprint=?", [fingerprint]);
    }
  };

  // When: fenced finalization rechecks the persisted SSH fingerprint.
  const denied = await serveGitSession(repo, {
    fingerprint,
    projectId: project.id,
    service: "git-receive-pack",
    run: async path => {
      await run({ args: ["-C", checkout, "push", path, "HEAD:refs/heads/main"] });
    },
  }).then(() => null, (error: unknown) => error);
  fixture.runtime.repositories.publish = publish;

  // Then: metadata remains old and the post-CAS repository intent stays unreadable.
  expect(denied).toMatchObject({ code: "GIT_AUTH_REQUIRED" });
  expect(await fixture.runtime.db.get("SELECT head FROM branch_heads WHERE project_id=? AND branch=?",
    [project.id, "main"])).toMatchObject({ head: before.head });
  expect(await fixture.runtime.db.all("SELECT id,state FROM repository_intents WHERE project_id=?", [project.id]))
    .toContainEqual(expect.objectContaining({ state: "published" }));
  expect(await fixture.runtime.db.all("SELECT id FROM core_git_intents")).toHaveLength(1);
  const hidden = await fixture.runtime.repositories.read(project.id, ["rev-parse", "main"])
    .then(() => null, (error: unknown) => error);
  expect(hidden).toMatchObject({ code: "REPOSITORY_NOT_FINALIZED" });
});

test("SSH push rollback recovers with the persisted fingerprint and a fresh branch fence", async () => {
  // Given: a current SSH push that publishes repository CAS but rolls back SQL finalization.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const repo = new GitRepository(fixture.service());
  const fingerprint = await addSshKey(fixture, owner.user.id);
  const checkout = join(fixture.path, "ssh-recovery");
  await cloneSession({ repo, fingerprint, projectId: project.id, checkout });
  const text = "\\documentclass{article}\n% recovered SSH push\n";
  const after = await commitCheckout(checkout, text);
  const record = fixture.runtime.events.record.bind(fixture.runtime.events);
  fixture.runtime.events.record = async (tx, event) => {
    if (event.topic === "git.changed") throw new Error("injected-ssh-finalization");
    return record(tx, event);
  };

  // When: the first finalization fails, then module registration recovers the durable intent.
  const failed = await serveGitSession(repo, {
    fingerprint,
    projectId: project.id,
    service: "git-receive-pack",
    run: async path => {
      await run({ args: ["-C", checkout, "push", path, "HEAD:refs/heads/main"] });
    },
  }).then(() => null, (error: unknown) => error);
  fixture.runtime.events.record = record;
  const persisted = await fixture.runtime.db.get<{ payload_json: string }>("SELECT payload_json FROM core_git_intents");
  expect(failed).toMatchObject({ message: "injected-ssh-finalization" });
  expect(JSON.parse(persisted?.payload_json ?? "{}")).toMatchObject({ sshFingerprint: fingerprint });
  expect(await fixture.runtime.db.get("SELECT head FROM branch_heads WHERE project_id=? AND branch=?",
    [project.id, "main"])).toMatchObject({ head: before.head });
  const hidden = await fixture.runtime.repositories.read(project.id, ["rev-parse", "main"])
    .then(() => null, (error: unknown) => error);
  expect(hidden).toMatchObject({ code: "REPOSITORY_NOT_FINALIZED" });
  await fixture.restart();

  // Then: recovery obtains current fencing and atomically exposes the original push.
  expect((await fixture.status(owner.headers, project.id)).head).toBe(`sha1:${after}`);
  expect((await fixture.service().readDocument({ projectId: project.id, branch: "main" },
    project.settings.mainFileId)).text).toBe(text);
  expect(await fixture.runtime.db.all("SELECT id FROM core_git_intents")).toHaveLength(0);
});
