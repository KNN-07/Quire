import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { baseFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

const scope = { projectId: ids.project, branch: "main" };
const route = `/api/projects/${ids.project}/effective-access?branch=main`;
const envelope = z.object({ data: endpoints.projectAccess.output });
async function share(app: Awaited<ReturnType<typeof baseFixture>>, role: "viewer" | "editor") {
  const owner = await app.login();
  await app.setPolicy(ids.project, { sharing: "anyone", anonymousRead: true });
  const project = await app.service.getProject(ids.project);
  const response = await app.request(`/api/projects/${ids.project}/link`, {
    method: "PUT", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": `"v${project.version}"` },
    body: JSON.stringify({ role, expectedVersion: project.version }),
  });
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await response.json()).data.urlOnce;
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new Error("Expected share token");
  return token;
}

test("reports actual named roles without exposing the owner-only member list", async () => {
  await using app = await baseFixture();
  for (const [email, role, edit, review] of [
    ["kien@quire.local", "owner", true, true], ["mai@quire.local", "editor", true, true],
    ["sam@quire.local", "reviewer", false, true], ["alex@quire.local", "viewer", false, false],
  ] as const) {
    const user = await app.login(email);
    const response = await app.request(route, { headers: user.headers });
    expect(response.status).toBe(200);
    const access = envelope.parse(await response.json()).data;
    expect(access.role).toBe(role);
    expect(access.capabilities).toMatchObject({ read: true, edit, compile: edit, review, join: false, manageAccess: role === "owner" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  const outsider = await app.login("outsider@quire.local");
  expect((await app.request(route, { headers: outsider.headers })).status).toBe(404);
  expect((await app.request(route)).status).toBe(401);
});

test("editor-link discovery is read-only and explicit admission requires CSRF", async () => {
  await using app = await baseFixture();
  const token = await share(app, "editor");
  const outsider = await app.login("outsider@quire.local");
  const headers = { ...outsider.headers, "x-project-token": token };
  const beforeResponse = await app.request(route, { headers });
  expect(beforeResponse.status).toBe(200);
  const before = envelope.parse(await beforeResponse.json()).data;
  expect(before).toMatchObject({ role: "editor", source: "link", capabilities: { edit: false, join: true, chat: false } });
  expect(await app.runtime.db.get("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?", [ids.project, outsider.user.id])).toBeNull();
  const anonymousResponse = await app.request(route, { headers: { "x-project-token": token } });
  expect(anonymousResponse.status).toBe(200);
  const anonymous = envelope.parse(await anonymousResponse.json()).data;
  expect(anonymous).toMatchObject({ actorId: null, capabilities: { edit: false, join: false } });
  const joinRoute = `/api/projects/${ids.project}/join`;
  const denied = await app.request(joinRoute, {
    method: "POST", headers: { cookie: outsider.headers.cookie, "x-project-token": token }, body: JSON.stringify({ scope }),
  });
  expect(denied.status).toBe(403);
  const joined = await app.request(joinRoute, { method: "POST", headers, body: JSON.stringify({ scope }) });
  expect(joined.status).toBe(200);
  expect(envelope.parse(await joined.json()).data).toMatchObject({ source: "link", capabilities: { edit: true, join: false } });
  await app.restart();
  expect(envelope.parse(await (await app.request(route, { headers: outsider.headers })).json()).data.capabilities.edit).toBe(true);
  await app.setPolicy(ids.project, { sharing: "named" });
  expect((await app.request(route, { headers: outsider.headers })).status).toBe(403);
  expect((await app.request(`/api/projects/${ids.project}/files?branch=main`, { headers: outsider.headers })).status).toBe(403);
  const compileDenied = await app.service.authorize(outsider.user.id, scope, "compile")
    .then(() => null, (error: unknown) => error);
  expect(compileDenied).toMatchObject({ code: "FORBIDDEN" });
});

test("viewer tokens never advertise mutation and current policy/maintenance removes capabilities", async () => {
  await using app = await baseFixture();
  const token = await share(app, "viewer");
  const outsider = await app.login("outsider@quire.local");
  const headers = { ...outsider.headers, "x-project-token": token };
  expect(envelope.parse(await (await app.request(route, { headers })).json()).data.capabilities)
    .toEqual({ read: true, edit: false, compile: false, review: false, chat: false, manageAccess: false, join: false });
  expect((await app.request(`/api/projects/${ids.project}/join`, { method: "POST", headers, body: JSON.stringify({ scope }) })).status).toBe(403);
  const owner = await app.login();
  await app.runtime.db.run("INSERT INTO operator_settings(key,value_json,version,updated_at) VALUES('editor-state',?,0,?)",
    [JSON.stringify({ closed: true, message: "Maintenance" }), app.runtime.clock.now()]);
  expect(envelope.parse(await (await app.request(route, { headers: owner.headers })).json()).data.capabilities)
    .toEqual({ read: true, edit: false, compile: false, review: false, chat: false, manageAccess: false, join: false });
  await app.runtime.db.run("UPDATE share_tokens SET revoked_at=? WHERE project_id=?", [app.runtime.clock.now(), ids.project]);
  expect((await app.request(route, { headers })).status).toBe(404);
});
