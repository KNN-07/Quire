import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { baseFixture } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";

test("discovers private project metadata for operator ownership administration", async () => {
  // Given: a real operator who is not a member of the seeded project.
  await using fixture = await baseFixture();
  const operator = await fixture.login("operator@quire.local");
  // When: the operator resolves its project URL through the administration list.
  const response = await fixture.request(`/api/admin/projects?url=${encodeURIComponent(`http://localhost:5173/project/${fixtureIds.project}`)}`,
    { headers: operator.headers });
  // Then: the native project identity/owner are discoverable without granting source access.
  expect(response.status).toBe(200);
  const page = z.object({ data: endpoints.adminProjects.output }).parse(await response.json()).data;
  expect(page.items).toHaveLength(1);
  expect(page.items[0]?.ownerId).toBe(fixtureIds.kien);
  expect((await fixture.request(`/api/projects/${fixtureIds.project}/files?branch=main`, { headers: operator.headers })).status).toBe(404);
});

test("denies administrative project discovery to an ordinary collaborator", async () => {
  // Given: a valid editor account.
  await using fixture = await baseFixture();
  const editor = await fixture.login("mai@quire.local");
  // When: it requests instance-wide project metadata.
  const response = await fixture.request("/api/admin/projects", { headers: editor.headers });
  // Then: project collaboration does not imply operator discovery.
  expect(response.status).toBe(403);
});
