import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sshFixture } from "./fixture";

for (const profile of [
  { remote: false, editor: false }, { remote: false, editor: true }, { remote: true, editor: false },
] as const) {
  const { remote, editor } = profile;
  test(`materializes real pushed source when ${editor ? "Editor" : "Owner"} uses ${remote ? "remote singleton" : "native"} repositories over SSH`, async () => {
    // Given: actual SSH authentication, a named-only clone, and a local commit.
    await using fixture = await sshFixture(remote);
    const owner = await fixture.login();
    const project = await fixture.create(owner.headers);
    const actor = editor ? await fixture.login("alex@quire.local") : owner;
    if (editor) await fixture.runtime.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'editor',?)",
        [crypto.randomUUID(), project.id, actor.user.id, fixture.runtime.clock.now()]);
    });
    await fixture.registerKey(actor.headers);
    if (remote) await rm(join(fixture.runtime.config.dataDir, "git"), { recursive: true, force: true });
    const work = join(fixture.root, "clone");
    const clone = await fixture.git(["clone", fixture.url(project.id), work]);
    expect(clone.code, clone.error).toBe(0);
    const original = await readFile(join(work, "main.tex"), "utf8");
    await writeFile(join(work, "main.tex"), `${original}% actual SSH push\n`);
    expect((await fixture.git(["add", "main.tex"], work)).code).toBe(0);
    expect((await fixture.git(["-c", "user.name=SSH Author", "-c", "user.email=ssh@example.test",
      "commit", "-m", "SSH publication"], work)).code).toBe(0);
    // When: an ordinary Git client pushes the commit through the actual SSH listener.
    const push = await fixture.git(["push", "origin", "main"], work);
    // Then: success means canonical ancestry and browser materialization, not quarantine-only success.
    expect(push.code, push.error).toBe(0);
    const document = await fixture.projects.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId);
    expect(document.text).toBe(`${original}% actual SSH push\n`);
    const fetched = await fixture.git(["fetch", "origin"], work);
    expect(fetched.code, fetched.error).toBe(0);
    const local = await fixture.git(["rev-parse", "HEAD"], work);
    const canonical = new TextDecoder().decode(await fixture.runtime.repositories.read(project.id,
      ["rev-parse", "refs/heads/main"])).trim();
    expect(canonical).toBe(local.out);
    console.info("SSH_REAL_PUSH_ACCEPTED", { remote, project: project.id, canonical, sourceBytes: document.text.length });
  }, 90_000);
}
