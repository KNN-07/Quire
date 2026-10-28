import { expect, setDefaultTimeout, test } from "bun:test";
import { GitRepository } from "../../../services/core/git";
import { RemoteRepository } from "../../../services/adapters/remote-git";
import { githubFixture } from "./provider-fixture";
import { remoteGitHarness } from "./harness";

setDefaultTimeout(20_000);

test("uses pinned generic HTTPS transport for clone fetch and push without embedding credentials", async () => {
  // Given
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin);
  await app.configure();
  const owner = await app.login();
  await app.connect(owner);
  const token = provider.tokens[0];
  if (!token) throw new TypeError("Provider fixture did not issue a token");
  const project = await app.createProject(owner, "Generic transport source");
  const scope = { projectId: project.id, branch: project.defaultBranch };
  await app.projects.serialized(scope, async (lease) => {
    await new GitRepository(app.projects).head(owner.user.id, scope, lease);
  });
  await using remote = await RemoteRepository.open({
    url: `${provider.origin}/owner/research.git`,
    credentials: { username: "git", password: token },
    options: { fixtureOrigins: [provider.origin] },
  });
  // When
  const before = await remote.files(await remote.head("main"));
  await remote.importBundle(await app.runtime.repositories.exportNamed(project.id));
  await remote.push({
    source: "refs/heads/main",
    destination: "refs/heads/generic-manual",
  });
  // Then
  expect(new TextDecoder().decode(before.find((file) => file.path === "main.tex")?.bytes)).toContain("Remote initial");
  expect(await provider.read("owner/research", "main.tex", "generic-manual")).toContain("\\documentclass");
  expect((await provider.branches("owner/research"))).toContain("refs/heads/generic-manual");
});
