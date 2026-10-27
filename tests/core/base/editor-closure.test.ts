import { expect, test } from "bun:test";
import { z } from "zod";
import { baseFixture, clock, errorEnvelope } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("closed editing blocks source writes and compile authorization while preserving reads", async () => {
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const revision = fixture.service.getBranch(scope).revision;
  fixture.runtime.db.query("INSERT INTO operator_settings(key,value_json,version,updated_at) VALUES('editor-state',?,1,?)")
    .run(JSON.stringify({ closed: true, message: "Maintenance" }), clock.now());
  const write = await fixture.request(`/api/projects/${ids.project}/files`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, path: "blocked.tex", kind: "file", text: "blocked", expectedVersion: revision }),
  });
  expect(write.status).toBe(503);
  expect(errorEnvelope.parse(await write.json()).error.code).toBe("EDITOR_CLOSED");
  const compileError: unknown = await fixture.service.authorize(owner.user.id, scope, "compile")
    .then(() => null, (error: unknown) => error);
  expect(compileError).toMatchObject({ code: "EDITOR_CLOSED" });
  expect(fixture.service.getBranch(scope).revision).toBe(revision);
  expect((await fixture.request(`/api/projects/${ids.project}/files?branch=main`, { headers: owner.headers })).status).toBe(200);
  fixture.runtime.db.query("UPDATE operator_settings SET value_json=? WHERE key='editor-state'")
    .run(JSON.stringify({ closed: false, message: "" }));
  await fixture.service.authorize(owner.user.id, scope, "compile");
});

test("closed editing blocks an Editor link before it grants membership", async () => {
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const outsider = await fixture.login("outsider@quire.local");
  const project = fixture.service.getProject(ids.project);
  fixture.setPolicy(project.id, { sharing: "anyone", anonymousRead: true });
  const enabled = await fixture.request(`/api/projects/${project.id}/link`, { method: "PUT",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": `"v${project.version}"` },
    body: JSON.stringify({ role: "editor", expectedVersion: project.version }) });
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await enabled.json()).data.urlOnce;
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new TypeError("Expected share token");
  fixture.runtime.db.query("INSERT INTO operator_settings(key,value_json,version,updated_at) VALUES('editor-state',?,1,?)")
    .run(JSON.stringify({ closed: true, message: "Maintenance" }), clock.now());
  const scope = { projectId: project.id, branch: "main" };
  const response = await fixture.request(`/api/projects/${project.id}/files`, { method: "POST",
    headers: { ...outsider.headers, "x-project-token": token, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, path: "blocked.txt", kind: "file", text: "blocked",
      expectedVersion: fixture.service.getBranch(scope).revision }) });
  expect(response.status).toBe(503);
  expect(fixture.runtime.db.query("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?")
    .get(project.id, outsider.user.id)).toBeNull();
});
