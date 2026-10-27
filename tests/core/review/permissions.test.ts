import { expect, test } from "bun:test";
import { z } from "zod";
import { ThreadSchema } from "@quire/contracts";
import { reviewFixture, mutation } from "./harness";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";

test("enforces viewer, reviewer, author and editor authority through direct HTTP review endpoints", async () => {
  // Given: four real authenticated roles in the seeded project.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const reviewer = await fixture.login("sam@quire.local");
  const viewer = await fixture.login("alex@quire.local");
  const editor = await fixture.login("mai@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const route = `/api/projects/${ids.project}/threads`;
  // When: each role attempts the operations whose authority differs.
  const forbidden = await fixture.request(route, mutation(viewer.headers, { scope, body: "forbidden", expectedVersion: 0 }));
  const created = await fixture.request(route, mutation(reviewer.headers, { scope, body: "review", expectedVersion: 0 }));
  const thread = z.object({ data: ThreadSchema }).parse(await created.json()).data;
  const comment = thread.comments[0];
  if (!comment) throw new TypeError("Expected comment");
  const editOther = await fixture.request(`/api/projects/${ids.project}/comments/${comment.id}`, {
    method: "PATCH", headers: editor.headers, body: JSON.stringify({ body: "overwrite", expectedVersion: 0 }),
  });
  const editOwn = await fixture.request(`/api/projects/${ids.project}/comments/${comment.id}`, {
    method: "PATCH", headers: reviewer.headers, body: JSON.stringify({ body: "updated", expectedVersion: 0 }),
  });
  const resolveDenied = await fixture.request(`${route}/${thread.id}/state`, mutation(reviewer.headers, { resolved: true, expectedVersion: 0 }));
  const reply = await fixture.request(`${route}/${thread.id}/replies`, mutation(reviewer.headers, { body: "reply", expectedVersion: 0 }));
  const resolved = await fixture.request(`${route}/${thread.id}/state`, mutation(owner.headers, { resolved: true, expectedVersion: 1 }));
  const deleted = await fixture.request(`${route}/${thread.id}`, { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ scope, expectedVersion: 2 }) });
  // Then: author-only edits and editor-only moderation are enforced, with no viewer comments.
  expect(forbidden.status).toBe(403);
  expect(editOther.status).toBe(403);
  expect(editOwn.status).toBe(200);
  expect(resolveDenied.status).toBe(403);
  expect(reply.status).toBe(200);
  expect(resolved.status).toBe(200);
  expect(deleted.status).toBe(200);
  expect(fixture.runtime.db.query<{ n: number }, []>("SELECT count(*) AS n FROM permanent_comment_tombstones").get()?.n).toBe(2);
});

test("allows named viewer chat and reads live chat policy", async () => {
  // Given: a named viewer with a genuine session and the project's actual policy.
  await using fixture = await reviewFixture();
  const viewer = await fixture.login("alex@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const route = `/api/projects/${ids.project}/chat`;
  // When: the named viewer chats, then the owner policy disables chat.
  const sent = await fixture.request(route, mutation(viewer.headers, { scope, body: "Named viewer", expectedVersion: 0 }));
  fixture.runtime.db.query(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
    VALUES(?,'project',?,?,?)`).run(crypto.randomUUID(), ids.project, JSON.stringify({ ...defaultPolicy, chat: false }), fixture.runtime.clock.now());
  const disabled = await fixture.request(route, mutation(viewer.headers, { scope, body: "blocked", expectedVersion: 0 }));
  const hidden = await fixture.request(`${route}?branch=main`, { headers: viewer.headers });
  // Then: a named viewer can chat only while current policy enables it.
  expect(sent.status).toBe(200);
  expect(disabled.status).toBe(403);
  expect(hidden.status).toBe(403);
});

test("replays metadata creates exactly once and rejects different payloads under the same idempotency key", async () => {
  // Given: an authenticated reviewer and one stable idempotency key.
  await using fixture = await reviewFixture();
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const input = mutation(reviewer.headers, { scope, body: "once", expectedVersion: 0 });
  const route = `/api/projects/${ids.project}/threads`;
  // When: the HTTP create is retried, then the same key is reused for different content.
  const first = await fixture.request(route, input);
  const original = z.object({ data: ThreadSchema }).parse(await first.json()).data;
  const second = await fixture.request(route, input);
  const duplicate = z.object({ data: ThreadSchema }).parse(await second.json()).data;
  const conflict = await fixture.request(route, { ...input,
    body: JSON.stringify({ scope, body: "different", expectedVersion: 0 }) });
  // Then: successful replies refer to one durable thread and reuse conflicts do not mutate it.
  expect(duplicate).toEqual(original);
  expect(conflict.status).toBe(409);
  expect(fixture.runtime.db.query<{ n: number }, []>("SELECT count(*) AS n FROM threads").get()?.n).toBe(1);
});
