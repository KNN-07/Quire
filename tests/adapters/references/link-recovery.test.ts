import { expect, test } from "bun:test";
import { z } from "zod";
import { FileEntrySchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { referencesFixture } from "./harness";
import { referenceProvider } from "./provider";

test("rolls back link/source/receipt together and recovers the core journal without redispatch or an expired claim", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin, { links: true });
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const scope = { projectId: fixtureIds.project, branch: "main" };
  const before = await fixture.service.listFiles(scope);
  const key = crypto.randomUUID();
  const request = { method: "POST", headers: { ...owner.headers, "idempotency-key": key },
    body: JSON.stringify({ scope, kind: "bibliography", path: "recovered-core-link.bib", grantId: grant.id,
      url: `${provider.origin}/users/123/items`, expectedVersion: (await fixture.service.getBranch(scope)).revision }) };
  // This real SQLite trigger changes authority between source DML and its finalization guard.
  await fixture.runtime.uow.run(tx => tx.exec(`CREATE TRIGGER references_link_test_fence
    AFTER UPDATE OF version ON projects
    WHEN NEW.id='${scope.projectId}' AND NEW.version>OLD.version
    BEGIN UPDATE provider_grants SET version=version+1 WHERE id='${grant.id}'; END`));
  const failed = await fixture.request(`/api/projects/${scope.projectId}/links`, request);
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await failed.json()).error.code).toBe("SOURCE_FINALIZATION_CONFLICT");
  expect(await fixture.service.listFiles(scope)).toEqual(before);
  expect(await fixture.runtime.db.all("SELECT * FROM reference_links")).toEqual([]);
  expect(await fixture.runtime.db.get<{ key: string }>("SELECT key FROM idempotency_results WHERE actor_id=? AND key=?", [owner.user.id, key])).toBeNull();
  expect(await fixture.runtime.db.get<{ count: number }>("SELECT count(*) AS count FROM base_source_intents")).toEqual({ count: 1 });
  expect(await fixture.runtime.db.get<{ count: number }>("SELECT count(*) AS count FROM adapter_grant_claims")).toEqual({ count: 0 });
  await fixture.runtime.uow.run(tx => tx.exec("DROP TRIGGER references_link_test_fence"));
  fixture.clock.advance(180_000);
  const calls = provider.state.requests.length;
  // When
  await fixture.restart();
  const replay = await fixture.request(`/api/projects/${scope.projectId}/links`, request);
  // Then
  expect(replay.status).toBe(200);
  const file = z.object({ data: FileEntrySchema }).parse(await replay.json()).data;
  expect(file).toMatchObject({ path: "recovered-core-link.bib", editable: false, link: { kind: "bibliography" } });
  expect(provider.state.requests).toHaveLength(calls);
  expect(await fixture.runtime.db.get<{ count: number }>("SELECT count(*) AS count FROM reference_links")).toEqual({ count: 1 });
  expect(await fixture.runtime.db.all("SELECT id FROM base_source_intents")).toEqual([]);
  await fixture.runtime.repositories.assertReadable(scope.projectId);
});
