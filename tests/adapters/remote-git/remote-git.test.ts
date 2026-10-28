import { expect, setDefaultTimeout, test } from "bun:test";
import { z } from "zod";
import { IdSchema, ProviderConfigSchema } from "@quire/contracts";
import { githubFixture } from "./provider-fixture";
import { remoteGitHarness } from "./harness";
import { action, importProject, operation } from "./test-helpers";

setDefaultTimeout(20_000);

test("reports exact provider and generic credential prerequisites", async () => {
  // Given
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin);
  const operator = await app.login("operator@quire.local");
  // When
  const [githubResponse, gitResponse] = await Promise.all([
    app.request("/api/admin/providers/github", { headers: operator.headers }),
    app.request("/api/admin/providers/git", { headers: operator.headers }),
  ]);
  // Then
  const github = z.object({ data: ProviderConfigSchema }).parse(await githubResponse.json()).data;
  const git = z.object({ data: ProviderConfigSchema }).parse(await gitResponse.json()).data;
  expect(github.capabilities["import"]).toEqual({
    enabled: false,
    state: "unconfigured",
    reason: "Missing: operator provider configuration; github OAuth client ID (model field); github OAuth client secret",
  });
  expect(git.capabilities["clone"]).toMatchObject({ enabled: false, state: "unconfigured" });
  await app.configure("git");
  const enabled = await app.request("/api/admin/providers/git", { headers: operator.headers });
  expect(z.object({ data: ProviderConfigSchema }).parse(await enabled.json()).data.capabilities["clone"])
    .toMatchObject({ enabled: true, state: "ready" });
});

test("lists and imports a real GitHub repository with durable encrypted grant and replay receipt", async () => {
  // Given
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin);
  await app.configure();
  const owner = await app.login();
  const grant = await app.connect(owner);
  const key = crypto.randomUUID();
  // When
  const firstList = await action({
    app, session: owner, grantId: grant.id, grantVersion: grant.version,
    name: "listRepositories", parameters: { limit: 50 }, key,
  });
  const replayedList = await action({
    app, session: owner, grantId: grant.id, grantVersion: grant.version,
    name: "listRepositories", parameters: { limit: 50 }, key,
  });
  const imported = await importProject({
    app, session: owner, grantId: grant.id, origin: provider.origin,
  });
  // Then
  expect(firstList.status).toBe(202);
  expect(replayedList.status).toBe(202);
  const firstOperation = await operation(firstList);
  expect((await operation(replayedList)).id).toBe(firstOperation.id);
  expect(provider.listCalls).toBe(1);
  const importedOperation = await operation(imported);
  const result = z.object({
    projectId: IdSchema, bindingId: IdSchema,
    branches: z.array(z.string()), tags: z.array(z.string()),
  }).parse(importedOperation.result);
  expect(result.branches).toContain("protected/release");
  expect(result.tags).toContain("v1.0.0");
  const document = await app.projects.readDocument(
    { projectId: result.projectId, branch: "main" },
    (await app.projects.getProject(result.projectId)).settings.mainFileId,
  );
  expect(document.text).toContain("Remote initial");
  await app.restart();
  expect((await app.projects.readDocument(
    { projectId: result.projectId, branch: "main" },
    (await app.projects.getProject(result.projectId)).settings.mainFileId,
  )).text).toContain("Remote initial");
  const token = provider.tokens[0];
  if (!token) throw new TypeError("Provider fixture did not issue a token");
  const stored = await app.runtime.db.get<{ encrypted_secret: Uint8Array }>(
    "SELECT encrypted_secret FROM provider_grants WHERE id=?",
    [grant.id],
  );
  expect(new TextDecoder().decode(stored?.encrypted_secret).includes(token)).toBe(false);
  expect(JSON.stringify(importedOperation.result)).not.toContain(token);
});
