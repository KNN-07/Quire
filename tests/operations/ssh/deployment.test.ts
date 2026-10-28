import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sshFixture } from "./fixture";

test("clones current authorized source when the actual deployed broker CLI runs in a separate process", async () => {
  // Given: the actual serve CLI, a separate high-port sshd, and the original native authority.
  await using fixture = await sshFixture(false, undefined, true);
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  await fixture.registerKey(owner.headers);
  const work = join(fixture.root, "deployed-clone");
  // When: an ordinary Git client authenticates to that deployed process pair.
  const cloned = await fixture.git(["clone", fixture.url(project.id), work]);
  // Then: the bytes are the existing authorized source, and disposal awaits both actual services.
  expect(cloned.code, cloned.error).toBe(0);
  expect(await readFile(join(work, "main.tex"), "utf8"))
    .toBe((await fixture.projects.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId)).text);
}, 90_000);
