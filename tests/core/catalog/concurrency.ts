import { strict as assert } from "node:assert";
import type { UnitOfWork } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { Library, Templates } from "../../../services/core/catalog";
import { transition } from "../../../services/core/catalog/publication";
import { fixtureIds } from "../../fixtures/foundation";
import { bib } from "./harness";
import type { catalogFixture } from "./harness";

/** Admit both contenders before either transaction starts; no timing assumption. */
function contenders(context: ModuleContext): ModuleContext {
  let entered = 0;
  let release: () => void = () => { throw new Error("Barrier not initialized"); };
  const ready = new Promise<void>(resolve => { release = resolve; });
  const uow: UnitOfWork = {
    run: async work => {
      if (++entered === 2) release();
      await ready;
      return context.uow.run(work);
    },
  };
  return { ...context, uow };
}

function oneConflict(results: readonly PromiseSettledResult<unknown>[]): void {
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected");
  assert(rejected?.status === "rejected");
  assert(rejected.reason instanceof Error && "code" in rejected.reason);
  assert.equal(rejected.reason.code, "STALE_VERSION");
}

export async function catalogConcurrency(fixture: Awaited<ReturnType<typeof catalogFixture>>): Promise<void> {
  const owner = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  const context: ModuleContext = { ...fixture.runtime, routes: fixture.runtime.routes.forLane("K") };
  const library = new Library(context);
  const entry = await library.create(owner.user.id, { bibtex: bib, origin: "manual" });
  const copies = new Library(contenders(context));
  oneConflict(await Promise.allSettled([
    copies.patch(owner.user.id, { id: entry.id, expectedVersion: entry.version, bibtex: "@book{winner,title={One}}" }),
    copies.patch(owner.user.id, { id: entry.id, expectedVersion: entry.version, bibtex: "@book{winner,title={Two}}" }),
  ]));
  assert.equal((await library.get(owner.user.id, entry.id)).version, entry.version + 1);

  const templates = new Templates(context);
  let version = await templates.create(owner.user.id, {
    name: "Concurrent publication", category: "", description: "", license: "MIT",
    visibility: "public", sourceProjectId: fixtureIds.project,
  });
  version = await transition(templates, owner.user.id, {
    id: version.templateId, expectedVersion: version.version, status: "submitted",
  });
  version = await transition(templates, operator.user.id, {
    id: version.templateId, expectedVersion: version.version, versionId: version.id, status: "approved",
  });
  const publishers = new Templates(contenders(context));
  oneConflict(await Promise.allSettled([0, 1].map(() => transition(publishers, operator.user.id, {
    id: version.templateId, expectedVersion: version.version, versionId: version.id, status: "published",
  }))));
  const published = await templates.get(null, version.templateId);
  assert.equal(published.snapshotId, version.snapshotId);
  assert.equal(published.id, version.id);
  assert.equal(published.status, "published");
  assert.equal(published.version, version.version + 1);
  assert.equal((await context.db.all("SELECT id FROM template_versions WHERE template_id=? AND status='published'", [version.templateId])).length, 1);

  const drafts = new Templates(contenders(context));
  oneConflict(await Promise.allSettled([0, 1].map(() => drafts.newVersion(owner.user.id, {
    id: published.templateId, snapshotId: published.snapshotId, expectedVersion: published.version,
  }))));
  const draft = await templates.get(owner.user.id, published.templateId);
  assert.equal(draft.status, "draft");
  assert.notEqual(draft.id, published.id);
  assert.equal(draft.snapshotId, published.snapshotId);
  assert.equal((await templates.get(null, published.templateId)).id, published.id);
  console.info("catalog.concurrent.pass", context.db.dialect, "library CAS, publication CAS, new-version CAS, exact snapshot");
}
