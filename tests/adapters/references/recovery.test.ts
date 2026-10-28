import { expect, test } from "bun:test";
import { FileEntrySchema, GitOidSchema, IdSchema } from "@quire/contracts";
import { ReferenceSourceJournal } from "../../../services/adapters/references/source-journal";
import { fixtureIds } from "../../fixtures/foundation";
import { referencesFixture } from "./harness";
import { referenceProvider } from "./provider";

test("recovers a journaled bibliography Git publication after restart before exposing source", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const scope = { projectId: fixtureIds.project, branch: "main" };
  const lease = await fixture.runtime.branches.acquire(scope, crypto.randomUUID(), 60_000);
  if (!lease) throw new TypeError("Branch lease required");
  const id = IdSchema.parse(crypto.randomUUID());
  const linkId = IdSchema.parse(crypto.randomUUID());
  const operationId = IdSchema.parse(crypto.randomUUID());
  const file = FileEntrySchema.parse({ id: crypto.randomUUID(), path: "recovered.bib", kind: "file", mime: "application/x-bibtex",
    blob: null, bytes: 0, editable: false, version: { revision: 0, epoch: 0 },
    link: { kind: "bibliography", sourceId: linkId, lastRefreshedAt: fixture.clock.now() } });
  const source = await fixture.service.prepareSource({ actorId: owner.user.id, scope, lease,
    expectedRevision: (await fixture.service.getBranch(scope)).revision,
    inputs: [...(await fixture.service.listFiles(scope)).map(entry => ({ file: entry })),
      { file, bytes: new TextEncoder().encode("@article{preserved_key,title={Recovered provider bytes}}\n") }] });
  const digest = source.files.find(entry => entry.id === file.id)?.blob;
  if (!digest) throw new TypeError("Prepared digest required");
  await fixture.runtime.uow.run(async tx => {
    await tx.run(`INSERT INTO operations(id,actor_id,kind,status,idempotency_key,created_at,updated_at)
      VALUES(?,?,?,'running',?,?,?)`, [operationId, owner.user.id, "zotero.bulkBib", "interrupted-bibliography",
      fixture.clock.now(), fixture.clock.now()]);
  });
  const journal = new ReferenceSourceJournal(fixture.references.retrieval.services);
  await journal.stage(id, {
    source, link: { id: linkId, grantId: grant.id, ownerId: owner.user.id, scope, fileId: file.id,
      selection: JSON.stringify({ libraryType: "users", libraryId: "123" }), digest, cursor: "7", expectedVersion: null },
    operationId, action: "bulkBib", grantVersion: grant.version, configVersion: 1, provider: "zotero", expectedCursor: null,
    result: { linkId, fileId: file.id, digest, count: 1, version: 1 },
  });
  await fixture.runtime.repositories.publish({ id, lease, updates: [{
    ref: `refs/quire/history/${source.snapshot.id}`, expected: null, next: GitOidSchema.parse(`sha1:${source.commit}`),
  }] });
  await fixture.runtime.branches.release(lease);
  // When
  await fixture.restart();
  // Then
  expect((await fixture.service.getFile(scope, file.id))).toMatchObject({ editable: false, blob: digest });
  expect(await fixture.runtime.db.get<{ status: string }>("SELECT status FROM operations WHERE id=?", [operationId]))
    .toEqual({ status: "succeeded" });
  expect(await fixture.runtime.db.all("SELECT id FROM reference_source_journal")).toEqual([]);
  await fixture.runtime.repositories.assertReadable(scope.projectId);
});
