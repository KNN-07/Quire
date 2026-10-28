import { expect, setDefaultTimeout, test } from "bun:test";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { githubFixture } from "./provider-fixture";
import { remoteGitHarness } from "./harness";

setDefaultTimeout(20_000);

test("leaves importCreate unregistered when standalone ownership is not explicitly enabled", async () => {
  // Given
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin, { standaloneImport: false });
  const owner = await app.login();
  // When
  const response = await app.request("/api/imports", {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      kind: "github",
      name: "No route owner",
      source: {
        kind: "git",
        url: `${provider.origin}/owner/research.git`,
        branch: "main",
      },
    }),
  });
  // Then
  expect(response.status).toBe(501);
  expect(z.object({ error: z.object({ code: z.literal("NOT_IMPLEMENTED") }) })
    .parse(await response.json()).error.code).toBe("NOT_IMPLEMENTED");
});

test("assembles remote recovery with interchange as the single importCreate owner", async () => {
  // Given: runtime construction itself proves no duplicate route registration.
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin, { interchange: true });
  await app.configure();
  const owner = await app.login();
  const grant = await app.connect(owner);
  // When
  const response = await app.request("/api/imports", {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      kind: "github",
      name: "Interchange-owned remote import",
      source: {
        kind: "git",
        url: `${provider.origin}/owner/research.git`,
        branch: "main",
        grantId: grant.id,
      },
    }),
  });
  // Then
  expect(response.status).toBe(202);
  const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
  const result = z.object({ projectId: IdSchema }).parse(operation.result);
  const project = await app.projects.getProject(result.projectId);
  expect((await app.projects.readDocument(
    { projectId: project.id, branch: project.defaultBranch },
    project.settings.mainFileId,
  )).text).toContain("Remote initial");
});
