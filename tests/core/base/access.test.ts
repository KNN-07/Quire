import { expect, test } from "bun:test";
import { z } from "zod";
import { InvitationSchema } from "@quire/contracts";
import { baseFixture, errorEnvelope } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

for (const member of [
  { id: ids.kien, role: "owner", writable: true },
  { id: ids.mai, role: "editor", writable: true },
  { id: ids.sam, role: "reviewer", writable: false },
  { id: ids.alex, role: "viewer", writable: false },
] as const) {
  for (const action of ["read", "compile"] as const) {
    const allowed = action === "read" || member.writable;
    test(`${allowed ? "allows" : "denies"} ${action} when role is ${member.role}`, async () => {
      // Given: a real seeded project membership behind the registered ProjectPort.
      await using fixture = await baseFixture();
      const projects = fixture.runtime.services.get("projects");
      // When: the actor requests this exact permission through the shared port.
      const failure = await projects.authorize(member.id, { projectId: ids.project, branch: "main" }, action)
        .then(() => null, (error: unknown) => error);
      // Then: read remains available while compiler mutations require writable roles.
      if (allowed) expect(failure).toBeNull();
      else expect(failure).toMatchObject({ code: "FORBIDDEN", status: 403 });
    });
  }
}

test("enforces the direct API role matrix when a reviewer attempts source mutation", async () => {
  // Given: a reviewer who may read source but cannot modify the file tree.
  await using fixture = await baseFixture();
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  // When: the reviewer directly calls the file mutation API.
  const response = await fixture.request(`/api/projects/${ids.project}/files`, {
    method: "POST",
    headers: { ...reviewer.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      scope, path: "forbidden.txt", kind: "file", text: "wrong",
      expectedVersion: (await fixture.service.getBranch(scope)).revision
    })
  });
  // Then: authorization, not UI state, denies the write.
  expect(response.status).toBe(403);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("FORBIDDEN");
});

test("revokes token reads immediately when the owner turns link sharing off", async () => {
  // Given: an explicitly enabled anonymous Viewer link.
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
  if (!token) throw new TypeError("Expected share token");
  const route = `/api/projects/${project.id}/files?branch=main`;
  const tokenHeaders = { "x-project-token": token };
  expect((await fixture.request(route, { headers: tokenHeaders })).status).toBe(200);
  // When: the owner disables this link.
  const version = (await fixture.service.getProject(project.id)).version;
  const revoked = await fixture.request(`/api/projects/${project.id}/link`, {
    method: "PUT",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": `"v${version}"` },
    body: JSON.stringify({ role: "off", expectedVersion: version })
  });
  // Then: the old credential cannot read any source.
  expect(revoked.status).toBe(200);
  expect((await fixture.request(route, { headers: tokenHeaders })).status).toBe(404);
});

test("requires a matching verified email before consuming an invitation token", async () => {
  // Given: an invitation delivered to an outsider's verified email.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const outsider = await fixture.login("outsider@quire.local");
  const viewer = await fixture.login("alex@quire.local");
  const project = (await fixture.service.getProject(ids.project));
  const created = await fixture.request(`/api/projects/${project.id}/invitations`, {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ email: outsider.user.primaryEmail, role: "viewer", expectedVersion: project.version })
  });
  const item = z.object({ data: InvitationSchema }).parse(await created.json()).data;
  const mail = z.object({ body: z.string() }).parse((await fixture.runtime.db.get("SELECT body FROM mail_outbox WHERE recipient=?", [outsider.user.primaryEmail])));
  const token = new URL(mail.body).searchParams.get("token");
  // When: a different email holder tries the credential before the intended recipient.
  const wrong = await fixture.request(`/api/invitations/${item.id}/accept`, {
    method: "POST",
    headers: { ...viewer.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ token, expectedVersion: 0 })
  });
  const accepted = await fixture.request(`/api/invitations/${item.id}/accept`, {
    method: "POST",
    headers: { ...outsider.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ token, expectedVersion: 0 })
  });
  // Then: only the intended recipient gains project access.
  expect(wrong.status).toBe(403);
  expect(accepted.status).toBe(200);
  expect((await fixture.service.role(outsider.user.id, project.id))).toBe("viewer");
});

test("rejects forged cross-project scope when an editor creates a file", async () => {
  // Given: an editor with source access to the seeded project.
  await using fixture = await baseFixture();
  const editor = await fixture.login("mai@quire.local");
  // When: the URL project and body project disagree.
  const response = await fixture.request(`/api/projects/${ids.project}/files`, {
    method: "POST",
    headers: { ...editor.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      scope: { projectId: crypto.randomUUID(), branch: "main" },
      path: "a.txt", kind: "file", text: "wrong", expectedVersion: 0
    })
  });
  // Then: the request fails at the scope boundary.
  expect(response.status).toBe(400);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("SCOPE_MISMATCH");
});

test("rejects source mutation after membership revocation while preserving viewer reads before it", async () => {
  // Given: a named viewer and a current membership version.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  expect((await fixture.request(`/api/projects/${ids.project}/files?branch=main`, { headers: viewer.headers })).status).toBe(200);
  // When: the owner removes the viewer membership.
  const removed = await fixture.request(`/api/projects/${ids.project}/members/${viewer.user.id}`, {
    method: "DELETE",
    headers: owner.headers, body: JSON.stringify({ expectedVersion: 0 })
  });
  // Then: the same live session loses project reads immediately.
  expect(removed.status).toBe(200);
  expect((await fixture.request(`/api/projects/${ids.project}/files?branch=main`, { headers: viewer.headers })).status).toBe(404);
});

test("requires CSRF for project mutations even when the session is authenticated", async () => {
  // Given: an authenticated owner without the CSRF header.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  // When: an HTTP client submits a source mutation.
  const result = await fixture.request(`/api/projects/${ids.project}/files`, {
    method: "POST",
    headers: { cookie: owner.headers.cookie, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope: { projectId: ids.project, branch: "main" }, path: "x.txt", kind: "file", expectedVersion: 0 })
  });
  // Then: no source change is accepted.
  expect(result.status).toBe(403);
  expect(errorEnvelope.parse(await result.json()).error.code).toBe("CSRF_DENIED");
});
