import { test, expect } from "bun:test";
import { z } from "zod";
import { unzipSync } from "fflate";
import { OperationSchema } from "@quire/contracts";
import { baseFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("revokes authenticated Editor-link grants without removing named collaborators", async () => {
  // Given: an Editor link and an outsider's real authenticated session.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const outsider = await fixture.login("outsider@quire.local");
  const project = (await fixture.service.getProject(ids.project));
  (await fixture.setPolicy(project.id, { sharing: "anyone", anonymousRead: true }));
  const enabled = await fixture.request(`/api/projects/${project.id}/link`, {
    method: "PUT",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": `"v${project.version}"` },
    body: JSON.stringify({ role: "editor", expectedVersion: project.version })
  });
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await enabled.json()).data.urlOnce;
  expect(new URL(url).pathname).toBe(`/projects/${project.id}/edit`);
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new TypeError("Expected link credential");
  const scope = { projectId: project.id, branch: "main" };
  const write = await fixture.request(`/api/projects/${project.id}/files`, {
    method: "POST",
    headers: { ...outsider.headers, "x-project-token": token, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      scope, path: "link-editor.txt", kind: "file", text: "edited",
      expectedVersion: (await fixture.service.getBranch(scope)).revision
    })
  });
  expect(write.status).toBe(200);
  // When: the owner disables the share link.
  const version = (await fixture.service.getProject(project.id)).version;
  const revoked = await fixture.request(`/api/projects/${project.id}/link`, {
    method: "PUT",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": `"v${version}"` },
    body: JSON.stringify({ role: "off", expectedVersion: version })
  });
  // Then: the transient link grant disappears but Mai's named Editor membership remains.
  expect(revoked.status).toBe(200);
  expect((await fixture.request(`/api/projects/${project.id}/files?branch=main`, { headers: outsider.headers })).status).toBe(404);
  expect((await fixture.service.role(ids.mai, project.id))).toBe("editor");
});

test("allows a logged-in Viewer-link reader to create an independent copy without granting membership", async () => {
  // Given: an outsider with a Viewer link, but no named project role.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const outsider = await fixture.login("outsider@quire.local");
  const project = (await fixture.service.getProject(ids.project));
  (await fixture.setPolicy(project.id, { sharing: "anyone", anonymousRead: true }));
  const enabled = await fixture.request(`/api/projects/${project.id}/link`, {
    method: "PUT",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": `"v${project.version}"` },
    body: JSON.stringify({ role: "viewer", expectedVersion: project.version })
  });
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await enabled.json()).data.urlOnce;
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new TypeError("Expected link credential");
  // When: the authenticated link reader copies this source.
  const response = await fixture.request(`/api/projects/${project.id}/copy`, {
    method: "POST",
    headers: { ...outsider.headers, "x-project-token": token, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ name: "Viewer copy", expectedVersion: (await fixture.service.getProject(project.id)).version })
  });
  // Then: the new project belongs to the reader without permanent source-project access.
  expect(response.status).toBe(200);
  const copied = z.object({ data: z.object({ ownerId: z.string() }) }).parse(await response.json()).data;
  expect(copied.ownerId).toBe(outsider.user.id);
  expect((await fixture.runtime.db.get("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?", [project.id, outsider.user.id]))).toBeNull();
});

test("denies a new writable grant when the configured Editor capacity is already full", async () => {
  // Given: an owner whose project already has one Editor and allows no more.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const project = (await fixture.service.getProject(ids.project));
  (await fixture.setPolicy(project.id, { writableMembers: 1 }));
  // When: the owner invites another Editor.
  const response = await fixture.request(`/api/projects/${project.id}/invitations`, {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ email: "outsider@quire.local", role: "editor", expectedVersion: project.version })
  });
  // Then: policy denies the grant before creating an invitation or mail.
  expect(response.status).toBe(403);
  expect((await fixture.runtime.db.get("SELECT 1 FROM invitations WHERE project_id=?", [project.id]))).toBeNull();
});

test("downloads a real source ZIP anonymously with a live Viewer token and denies it after revocation", async () => {
  // Given: a project with an explicitly allowed anonymous Viewer link.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const project = (await fixture.service.getProject(ids.project));
  (await fixture.setPolicy(project.id, { sharing: "anyone", anonymousRead: true }));
  const enabled = await fixture.request(`/api/projects/${project.id}/link`, {
    method: "PUT",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": `"v${project.version}"` },
    body: JSON.stringify({ role: "viewer", expectedVersion: project.version })
  });
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await enabled.json()).data.urlOnce;
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new TypeError("Expected link credential");
  const headers = { "x-project-token": token, "idempotency-key": crypto.randomUUID() };
  // When: the anonymous reader exports and downloads source across a runtime restart.
  const response = await fixture.request(`/api/projects/${project.id}/exports`, {
    method: "POST", headers,
    body: JSON.stringify({ kind: "source" })
  });
  const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
  await fixture.restart();
  const download = await fixture.request(`/api/operations/${operation.id}/download`, { headers });
  const content = unzipSync(new Uint8Array(await download.arrayBuffer()));
  // Then: actual source is downloadable only while that credential remains live.
  expect(content["main.tex"]).toBeInstanceOf(Uint8Array);
  const version = (await fixture.service.getProject(project.id)).version;
  await fixture.request(`/api/projects/${project.id}/link`, {
    method: "PUT",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": `"v${version}"` },
    body: JSON.stringify({ role: "off", expectedVersion: version })
  });
  expect((await fixture.request(`/api/operations/${operation.id}/download`, { headers })).status).toBe(404);
  const stored = (await fixture.runtime.db.all("SELECT response_json FROM idempotency_results WHERE route=?", [`accessLink:${project.id}`]));
  expect(JSON.stringify(stored)).not.toContain(token);
});
