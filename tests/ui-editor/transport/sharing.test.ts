import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints, resourceVersionTag } from "@quire/contracts";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";
import { mutation } from "../../core/review/harness";
import { changed, transportFixture } from "./harness";

test("initializes anonymous share documents without leaking credentials and closes on actual token revocation", async () => {
  // Given: an actual anonymous Viewer link under the configured sharing policy.
  await using setup = await transportFixture();
  const owner = await setup.fixture.login();
  await setup.fixture.runtime.db.run("UPDATE organizations SET policy_json=?", [
    JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: true }),
  ]);
  const create = mutation(owner.headers, { role: "viewer", expectedVersion: 0 });
  const response = await setup.fixture.request(`/api/projects/${ids.project}/link`, {
    ...create, method: "PUT", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": resourceVersionTag(0) },
  });
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await response.json()).data.urlOnce;
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new TypeError("Missing actual share token");
  const anonymous = await setup.anonymous(token);
  expect(anonymous.document.getSnapshot().readOnly).toBe(true);
  expect(anonymous.document.source.length).toBeGreaterThan(0);
  const uncredentialed = await anonymous.client.call(endpoints.projectAccess, {
    params: { p: ids.project }, query: { branch: "main" }, body: undefined,
  });
  expect("error" in uncredentialed).toBe(true);
  const recovery = changed(anonymous.document, () => anonymous.document.getSnapshot().persistence.kind === "recovery");
  const version = (await setup.fixture.service.getProject(ids.project)).version;
  // When: the owner revokes the same persisted token through the real HTTP route.
  const revoke = await setup.fixture.request(`/api/projects/${ids.project}/link`, {
    method: "PUT", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": resourceVersionTag(version) },
    body: JSON.stringify({ role: "off", expectedVersion: version }),
  });
  await recovery;
  // Then: both initialization transports used the credential, but revocation terminates the document.
  expect(revoke.status).toBe(200);
  expect(anonymous.document.getSnapshot().persistence).toMatchObject({ kind: "recovery" });
});
