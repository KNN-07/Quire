import { expect, test } from "bun:test";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { referenceBlob } from "@quire/runtime";
import { baseFixture, clock, errorEnvelope } from "./harness";

async function diagnosticOperation(fixture: Awaited<ReturnType<typeof baseFixture>>, actorId: Id) {
  const bytes = new Uint8Array([1, 3, 5, 7]);
  const blob = await fixture.runtime.blobs.put(bytes);
  const id = IdSchema.parse(crypto.randomUUID());
  (await fixture.runtime.uow.run(async (tx) => {
    await tx.lock("quire:accounts");

    (await referenceBlob(tx, { digest: blob, bytes: bytes.length }, clock));
    (await tx.run(`INSERT INTO operations(id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at)
      VALUES(?,?,'diagnostics','succeeded',1,?,?,?,?)`, [id, actorId, JSON.stringify({
      blob, projectIds: [], operatorOnly: true,
      filename: "private-diagnostic.bin", mime: "application/octet-stream"
    }), crypto.randomUUID(), clock.now(), clock.now()]));

  }));
  return { id, bytes };
}

test("downloads an operator-only result while its owner remains an operator", async () => {
  // Given: a real authenticated operator and a durably published private result.
  await using fixture = await baseFixture();
  const operator = await fixture.login("operator@quire.local");
  const operation = await diagnosticOperation(fixture, operator.user.id);
  // When: the operator downloads through the real HTTP route.
  const response = await fixture.request(`/api/operations/${operation.id}/download`, { headers: operator.headers });
  // Then: authorization preserves the actual stored bytes.
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="private-diagnostic.bin"');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(operation.bytes);
});

test("denies an operator-only result after the owning account loses operator access", async () => {
  // Given: an existing session whose account has since been demoted.
  await using fixture = await baseFixture();
  const operator = await fixture.login("operator@quire.local");
  const operation = await diagnosticOperation(fixture, operator.user.id);
  (await fixture.runtime.db.run("UPDATE users SET operator=0,version=version+1 WHERE id=?", [operator.user.id]));
  // When: the same valid user session requests the privileged result.
  const response = await fixture.request(`/api/operations/${operation.id}/download`, { headers: operator.headers });
  // Then: historical ownership does not bypass current operator authorization.
  expect(response.status).toBe(403);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("FORBIDDEN");
});
