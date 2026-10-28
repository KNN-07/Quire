import { expect, setDefaultTimeout, test } from "bun:test";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { gitlabFixture } from "./gitlab-fixture";
import { remoteGitHarness } from "./harness";

const operationEnvelope = z.object({ data: OperationSchema });
setDefaultTimeout(20_000);

test("lists and imports a real GitLab repository through OAuth and smart HTTP", async () => {
  // Given
  await using provider = await gitlabFixture();
  await using app = await remoteGitHarness(provider.origin);
  await app.configure("gitlab");
  const owner = await app.login();
  const grant = await app.connect(owner, "gitlab");
  // When
  const listedResponse = await app.request(`/api/connections/${grant.id}/actions`, {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      action: "listRepositories",
      parameters: { limit: 50 },
      expectedVersion: grant.version,
      expectedCursor: null,
    }),
  });
  const importedResponse = await app.request(`/api/connections/${grant.id}/actions`, {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      action: "import",
      parameters: {
        name: "Imported GitLab project",
        url: `${provider.origin}/owner/research.git`,
        branch: "main",
      },
      expectedVersion: grant.version,
      expectedCursor: null,
    }),
  });
  // Then
  expect(listedResponse.status).toBe(202);
  const listed = operationEnvelope.parse(await listedResponse.json()).data;
  expect(z.object({
    repositories: z.array(z.object({ fullName: z.literal("owner/research") })),
  }).parse(listed.result).repositories).toHaveLength(1);
  expect(importedResponse.status).toBe(202);
  const imported = operationEnvelope.parse(await importedResponse.json()).data;
  const projectId = z.object({ projectId: IdSchema }).parse(imported.result).projectId;
  const project = await app.projects.getProject(projectId);
  expect((await app.projects.readDocument(
    { projectId, branch: "main" },
    project.settings.mainFileId,
  )).text).toContain("GitLab initial");
});
