import { expect, test } from "bun:test";
import { endpoints } from "@quire/contracts";
import { z } from "zod";
import { fixtureIds } from "../../fixtures/foundation";
import { dropboxServer } from "./provider";
import { dropboxFixture, scope } from "./harness";

test("Dropbox policy HTTP enforces authority, versions, deny-wins and persistence", async () => {
  // Given: a real connected project and its organization administrator.
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  const { fixture, owner } = harness;
  const projectPath = `/api/dropbox/policies/project/${scope.projectId}`;
  const organizationPath = `/api/dropbox/policies/organization/${fixtureIds.team}`;
  const schema = z.object({ data: endpoints.dropboxPolicyGet.output });
  const outsider = await fixture.login("outsider@quire.local");
  const body = JSON.stringify({ enabled: false, expectedVersion: 0 });
  // When: policy requests cross the actual authentication/version boundaries.
  expect((await fixture.request(projectPath)).status).toBe(401);
  expect((await fixture.request(projectPath, { headers: outsider.headers })).status).toBe(404);
  expect((await fixture.request(projectPath, { method: "PUT", headers: { cookie: owner.headers.cookie }, body })).status).toBe(403);
  const denied = await fixture.request(organizationPath, { method: "PUT", headers: owner.headers, body });
  expect(denied.status).toBe(200);
  expect(schema.parse(await denied.json()).data).toEqual({ enabled: false, effectiveEnabled: false, version: 1 });
  expect((await fixture.request(organizationPath, { method: "PUT", headers: owner.headers, body })).status).toBe(409);
  await harness.restart();
  // Then: organization denial is visible even though the project's local setting is enabled.
  const project = await fixture.request(projectPath, { headers: owner.headers });
  expect(schema.parse(await project.json()).data).toEqual({ enabled: true, effectiveEnabled: false, version: 0 });
  const count = provider.observed.length;
  expect((await harness.action("initialSync")).status).toBe(403);
  expect(provider.observed.length).toBe(count);
});
