import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { connectedFixture } from "./connected-fixture";

test("owner reads the durable adapter cursor after restart and uses it for the next action", async () => {
  // Given: a real provider grant and one completed action.
  await using setup = await connectedFixture();
  const route = `/api/connections/${setup.grant.id}/cursor?action=sync`;
  const schema = z.object({ data: endpoints.connectionCursor.output });
  const before = schema.parse(await (await setup.fixture.request(route, { headers: setup.owner.headers })).json()).data;
  expect(before).toEqual({ cursor: null, grantVersion: setup.grant.version });
  expect((await setup.action({ value: "first" })).status).toBe(202);
  await setup.fixture.restart();
  // When: the owner obtains the persisted cursor and submits another action.
  const after = schema.parse(await (await setup.fixture.request(route, { headers: setup.owner.headers })).json()).data;
  const next = await setup.action({ value: "next" }, { expectedCursor: after.cursor });
  // Then: cursor authority permits progress while anonymous and foreign grants remain inaccessible.
  expect(after).toEqual({ cursor: "1", grantVersion: setup.grant.version });
  expect(next.status).toBe(202);
  expect((await setup.fixture.request(route)).status).toBe(401);
  const outsider = await setup.fixture.login("outsider@quire.local");
  expect((await setup.fixture.request(route, { headers: outsider.headers })).status).toBe(404);
});
