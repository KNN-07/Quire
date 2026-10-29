import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { baseFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("invitation recipients can read the current version without gaining project access", async () => {
  // Given a real invitation whose first token was superseded by a resend.
  await using app = await baseFixture();
  const owner = await app.login();
  const recipient = await app.login("outsider@quire.local");
  const other = await app.login("alex@quire.local");
  const project = await app.service.getProject(ids.project);
  const created = resultSchema(endpoints.invitationCreate.output).parse(await (await app.request(
    `/api/projects/${ids.project}/invitations`, {
      method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ email: "outsider@quire.local", role: "reviewer", expectedVersion: project.version }),
    })).json());
  if ("error" in created) throw new TypeError(created.error.message);
  const id = created.data.id;
  expect((await app.request(`/api/projects/${ids.project}/invitations/${id}/resend`, {
    method: "POST", headers: owner.headers, body: JSON.stringify({ expectedVersion: 0 }),
  })).status).toBe(200);
  // When the actual verified recipient reads the emailed invitation.
  const preview = await app.request(`/api/invitations/${id}`, { headers: recipient.headers });
  // Then the current version is private and no access is granted by a read.
  expect(preview.status).toBe(200);
  const body = await preview.json();
  expect(body).toMatchObject({ data: { invitation: { id, version: 1, role: "reviewer" }, projectName: project.name } });
  expect(JSON.stringify(body)).not.toContain("token_hash");
  expect(preview.headers.get("cache-control")).toBe("private, no-store");
  expect((await app.request(`/api/projects/${ids.project}?branch=main`, { headers: recipient.headers })).status).toBe(404);
  expect((await app.request(`/api/invitations/${id}`, { headers: other.headers })).status).toBe(403);
  expect((await app.request(`/api/invitations/${id}`)).status).toBe(401);
});
