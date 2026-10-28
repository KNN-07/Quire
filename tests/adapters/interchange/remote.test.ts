import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { sharedRemoteImporter } from "../../../services/adapters/interchange";
import { githubFixture } from "../remote-git/provider-fixture";
import { remoteGitHarness } from "../remote-git/harness";
import { rejectionCode } from "./harness";

test("delegates a GitHub import through encrypted shared grants to real Git objects", async () => {
  // Given
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin);
  await app.configure();
  const owner = await app.login();
  const grant = await app.connect(owner);
  const importRemote = sharedRemoteImporter({ ...app.runtime, routes: app.runtime.routes.forLane("X") });
  const input = { kind: "github", name: "Delegated native interchange", source: {
    kind: "git", url: `${provider.origin}/owner/research.git`, branch: "main", grantId: grant.id,
  } } as const;
  // When
  const operation = await importRemote(owner.user.id, input, {
    actorId: owner.user.id, key: "delegated-github-import", route: "importCreate",
    digest: new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex"),
  });
  // Then
  expect(operation.status).toBe("succeeded");
  const result = z.object({ projectId: IdSchema, branches: z.array(z.string()), tags: z.array(z.string()) }).parse(operation.result);
  const project = await app.projects.getProject(result.projectId);
  expect((await app.projects.readDocument({ projectId: project.id, branch: project.defaultBranch },
    project.settings.mainFileId)).text).toContain("Remote initial");
  expect(result.branches).toContain("protected/release");
  expect(result.tags).toContain("v1.0.0");
}, 120_000);

test("denies another user's grant when delegating a remote Git import", async () => {
  // Given
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin);
  await app.configure();
  const owner = await app.login();
  const grant = await app.connect(owner);
  const other = await app.login("mai@quire.local");
  const importRemote = sharedRemoteImporter({ ...app.runtime, routes: app.runtime.routes.forLane("X") });
  const input = { kind: "github", name: "Denied interchange", source: {
    kind: "git", url: `${provider.origin}/owner/research.git`, branch: "main", grantId: grant.id,
  } } as const;
  // When
  const code = await rejectionCode(importRemote(other.user.id, input, {
    actorId: other.user.id, key: "denied-github-import", route: "importCreate",
    digest: new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex"),
  }));
  // Then
  expect(code).toBe("GRANT_NOT_FOUND");
}, 120_000);
