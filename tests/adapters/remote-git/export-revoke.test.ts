import { expect, setDefaultTimeout, test } from "bun:test";
import { z } from "zod";
import { githubFixture } from "./provider-fixture";
import { remoteGitHarness } from "./harness";
import { action, operation } from "./test-helpers";

const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });
setDefaultTimeout(20_000);

test("exports a new repository, disconnects its binding, and revokes the upstream grant", async () => {
  // Given
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin);
  await app.configure();
  const owner = await app.login();
  const grant = await app.connect(owner);
  const project = await app.createProject(owner, "Exported project");
  // When
  const exported = await operation(await action({
    app, session: owner, grantId: grant.id, grantVersion: grant.version,
    name: "exportNew", projectId: project.id,
    parameters: { name: "exported-project", private: true },
  }));
  const binding = z.object({ version: z.number() }).parse(await app.runtime.db.get(
    "SELECT version FROM remote_bindings WHERE project_id=?", [project.id],
  ));
  const disconnected = await operation(await action({
    app, session: owner, grantId: grant.id, grantVersion: grant.version,
    name: "disconnect", projectId: project.id,
    parameters: { expectedBindingVersion: binding.version },
    expectedCursor: null,
  }));
  const revoked = await app.request(`/api/connections/${grant.id}`, {
    method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ expectedVersion: grant.version }),
  });
  // Then
  expect(await provider.read("fixture-user/exported-project", "main.tex")).toContain("\\documentclass");
  expect(disconnected.result).toEqual({
    disconnected: true,
    bindingId: z.object({ bindingId: z.string() }).parse(exported.result).bindingId,
  });
  expect(await app.runtime.db.get(
    "SELECT id FROM remote_bindings WHERE project_id=?", [project.id],
  )).toBeNull();
  expect(revoked.status).toBe(200);
  const denied = await action({
    app, session: owner, grantId: grant.id, grantVersion: grant.version + 1,
    name: "listRepositories", parameters: { limit: 50 },
  });
  expect(errorEnvelope.parse(await denied.json()).error.code).toBe("GRANT_UNAVAILABLE");
});
