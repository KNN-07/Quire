import { expect, test } from "bun:test";
import { endpoints } from "@quire/contracts";
import { data, governanceFixture } from "./harness";

test("reads the persisted editor maintenance version for an operator", async () => {
  // Given: a nonzero saved instance policy and a real operator session.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  await app.runtime.db.run("INSERT INTO operator_settings(key,value_json,version,updated_at) VALUES('editor-state',?,8,?)", [JSON.stringify({ closed: true, message: "Scheduled maintenance" }), app.runtime.clock.now()]);
  // When: the operator opens the maintenance controls.
  const response = await operator.get("/api/admin/editor-state");
  // Then: the actual guard and state are available without a guessed version.
  expect(response.headers.get("etag")).toBe('"v8"');
  expect(await data(response, endpoints.adminEditorStateGet.output)).toEqual({
    closed: true, message: "Scheduled maintenance", version: 8,
  });
});

test("denies maintenance configuration reads to a non-operator", async () => {
  // Given: an ordinary authenticated account.
  await using app = await governanceFixture();
  const user = await app.login();
  // When: it requests the operator policy.
  const response = await user.get("/api/admin/editor-state");
  // Then: the management read stays privileged.
  expect(response.status).toBe(403);
});
