import { expect, test } from "bun:test";
import { z } from "zod";
import { EventSchema, resourceVersionTag } from "@quire/contracts";
import { reviewFixture, mutation } from "./harness";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";

test("authorizes anonymous SSE by its live Viewer token, replays Last-Event-ID and terminates on revocation", async () => {
  // Given: a real anonymous Viewer grant and an actual SSE stream scoped by that credential.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  fixture.runtime.db.query("UPDATE organizations SET policy_json=?")
    .run(JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: true }));
  const input = mutation(owner.headers, { role: "viewer", expectedVersion: 0 });
  const grant = await fixture.request(`/api/projects/${ids.project}/link`, { ...input, method: "PUT",
    headers: { ...Object.fromEntries(new Headers(input.headers)), "if-match": resourceVersionTag(0) } });
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await grant.json()).data.urlOnce;
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new TypeError("Expected real Viewer token");
  const response = await fixture.request("/api/events?after=0", { headers: { "x-project-token": token } });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("Expected anonymous SSE response");
  const other = await fixture.create(owner.headers);
  const first = await fixture.service.snapshot(owner.user.id, { projectId: ids.project, branch: "main" }, 0);
  let firstText = "";
  while (!firstText.includes(first.id)) {
    const part = await reader.read();
    if (part.done) throw new TypeError("Anonymous stream ended before its checkpoint");
    firstText += new TextDecoder().decode(part.value);
  }
  const delivered = firstText.split("\n").filter(line => line.startsWith("data: "))
    .map(line => EventSchema.parse(JSON.parse(line.slice(6))));
  const cursor = Math.max(...delivered.map(event => event.seq));
  await reader.cancel();
  const second = await fixture.service.snapshot(owner.user.id, { projectId: ids.project, branch: "main" }, 0);
  // When: the client reconnects with Last-Event-ID, then its owner revokes the live token.
  const replay = await fixture.request("/api/events?after=0",
    { headers: { "x-project-token": token, "last-event-id": String(cursor) } });
  const replayReader = replay.body?.getReader();
  if (!replayReader) throw new TypeError("Expected replay response");
  let replayText = "";
  while (!replayText.includes(second.id)) {
    const part = await replayReader.read();
    if (part.done) throw new TypeError("Replay ended before the new checkpoint");
    replayText += new TextDecoder().decode(part.value);
  }
  const version = fixture.service.getProject(ids.project).version;
  const revoke = mutation(owner.headers, { role: "off", expectedVersion: version });
  const revoked = await fixture.request(`/api/projects/${ids.project}/link`, { ...revoke, method: "PUT",
    headers: { ...Object.fromEntries(new Headers(revoke.headers)), "if-match": resourceVersionTag(version) } });
  let ended = false;
  while (!ended) ended = (await replayReader.read()).done;
  // Then: replay starts after the cursor, private projects never leak, and revocation ends the subscription.
  expect(revoked.status).toBe(200);
  expect(firstText).not.toContain(other.id);
  expect(replayText).not.toContain(first.id);
  expect(replayText.split("\n").filter(line => line.startsWith("data: "))
    .map(line => EventSchema.parse(JSON.parse(line.slice(6)))).every(event => event.seq > cursor)).toBe(true);
  expect(ended).toBe(true);
  await replayReader.cancel();
});
