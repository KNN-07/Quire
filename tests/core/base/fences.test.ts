import { expect, spyOn, test } from "bun:test";
import type { BranchLease } from "@quire/contracts";
import { baseFixture, clock } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { recoverBranch } from "../../../services/core/base/source-recovery";
import { FileEntrySchema } from "@quire/contracts";
import { emptyFile, mutateFiles } from "../../../services/core/base";

test.each(["before-publish", "before-finalize"] as const)(
  "durable takeover fences a paused writer %s and recovers exactly once", async boundary => {
    await using fixture = await baseFixture();
    const scope = { projectId: ids.project, branch: "main" };
    const branch = await fixture.service.getBranch(scope);
    const original = await fixture.service.readDocument(scope, ids.mainFile);
    const files = await fixture.service.listFiles(scope);
    const published = fixture.runtime.repositories.publish.bind(fixture.runtime.repositories);
    let successor: BranchLease | null = null;
    const fault = spyOn(fixture.runtime.repositories, "publish").mockImplementationOnce(async intent => {
      if (boundary === "before-finalize") await published(intent);
      await fixture.runtime.db.run("UPDATE branch_leases SET expires_at=? WHERE project_id=? AND branch=?",
        [clock.now(), scope.projectId, scope.branch]);
      successor = await fixture.runtime.branches.acquire(scope, "takeover", 60_000);
      expect(successor?.fence).toBe(intent.lease.fence + 1);
      if (boundary === "before-publish") await published(intent);
    });
    try {
      const failure = await fixture.service.serialized(scope, lease => fixture.service.commitSource({
        actorId: ids.kien, scope, lease, expectedRevision: branch.revision,
        inputs: files.map(file => ({
          file, ...(file.id === ids.mainFile
            ? { bytes: new TextEncoder().encode(`${original.text}\n% fenced recovery\n`) } : {})
        })),
      })).then(() => null, (error: unknown) => error);
      expect(failure).toMatchObject({ code: "STALE_BRANCH_FENCE" });
      expect((await fixture.service.getBranch(scope)).revision).toBe(branch.revision);
      expect((await fixture.service.readDocument(scope, ids.mainFile)).text).toBe(original.text);
      expect(await fixture.runtime.db.all("SELECT id FROM base_source_intents")).toHaveLength(1);
      const lease = successor;
      if (!lease) throw new Error("Expected replacement lease");
      await recoverBranch(fixture.service.context, lease);
      await recoverBranch(fixture.service.context, lease);
      expect((await fixture.service.getBranch(scope)).revision).toBe(branch.revision + 1);
      expect((await fixture.service.readDocument(scope, ids.mainFile)).text).toBe(`${original.text}\n% fenced recovery\n`);
      expect(await fixture.runtime.db.all("SELECT id FROM base_source_intents")).toHaveLength(0);
      expect(await fixture.runtime.db.all("SELECT id FROM repository_intents WHERE state<>'finalized'")).toHaveLength(0);
    } finally {
      fault.mockRestore();
      if (successor) await fixture.runtime.branches.release(successor);
    }
  });

test("source finalization rechecks ACL after actual ref publication", async () => {
  await using fixture = await baseFixture();
  const scope = { projectId: ids.project, branch: "main" };
  const branch = await fixture.service.getBranch(scope);
  const files = await fixture.service.listFiles(scope);
  const published = fixture.runtime.repositories.publish.bind(fixture.runtime.repositories);
  const fault = spyOn(fixture.runtime.repositories, "publish").mockImplementationOnce(async intent => {
    await published(intent);
    await fixture.runtime.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.run("DELETE FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.mai]);
    });
  });
  try {
    const failure = await fixture.service.serialized(scope, lease => fixture.service.commitSource({
      actorId: ids.mai, scope, lease, expectedRevision: branch.revision, inputs: files.map(file => ({ file })),
    })).then(() => null, (error: unknown) => error);
    expect(failure).toMatchObject({ code: "NOT_FOUND" });
    expect((await fixture.service.getBranch(scope)).revision).toBe(branch.revision);
    expect(await fixture.runtime.db.all("SELECT id FROM base_source_intents")).toHaveLength(1);
    expect(await fixture.runtime.db.all("SELECT id FROM repository_intents WHERE state='published'")).toHaveLength(1);
  } finally { fault.mockRestore(); }
});

test("blob and repository I/O remain outside SQLite transactions", async () => {
  await using fixture = await baseFixture();
  const blobs = fixture.runtime.blobs;
  const repositories = fixture.runtime.repositories;
  const put = blobs.put.bind(blobs);
  const get = blobs.get.bind(blobs);
  const objects = repositories.objects.bind(repositories);
  const initialize = repositories.initialize.bind(repositories);
  let probes = 0;
  const probe = async () => {
    // The real executor rejects this root access if a SQL callback is active.
    await fixture.runtime.db.get("SELECT 1");
    probes++;
  };
  const spies = [
    spyOn(blobs, "put").mockImplementation(async bytes => { await probe(); return put(bytes); }),
    spyOn(blobs, "get").mockImplementation(async digest => { await probe(); return get(digest); }),
    spyOn(repositories, "objects").mockImplementation(async (...args) => { await probe(); return objects(...args); }),
    spyOn(repositories, "initialize").mockImplementation(async id => { await probe(); return initialize(id); }),
  ];
  try {
    const project = await fixture.service.create(ids.kien, { name: "No SQL around I/O", origin: { kind: "blank" } });
    expect((await fixture.service.listFiles({ projectId: project.id, branch: "main" }))).toHaveLength(1);
    expect(probes).toBeGreaterThanOrEqual(6);
  } finally { for (const spy of spies) spy.mockRestore(); }
});

test("linked-source finalization rechecks the parent ACL as well as the child", async () => {
  await using fixture = await baseFixture();
  const child = await fixture.service.create(ids.mai, { name: "Child owner", origin: { kind: "blank" } });
  const scope = { projectId: child.id, branch: "main" };
  const source = await fixture.service.getFile({ projectId: ids.project, branch: "main" }, ids.mainFile);
  const linked = FileEntrySchema.parse({ ...emptyFile("linked.tex", "file"), blob: source.blob, bytes: source.bytes,
    link: { kind: "project", sourceId: `${ids.project}:${source.id}`, lastRefreshedAt: clock.now() } });
  const publish = fixture.runtime.repositories.publish.bind(fixture.runtime.repositories);
  const fault = spyOn(fixture.runtime.repositories, "publish").mockImplementationOnce(async intent => {
    await publish(intent);
    await fixture.runtime.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.run("DELETE FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.mai]);
    });
  });
  try {
    const failed = await mutateFiles(fixture.service, { actorId: ids.mai, scope, expectedVersion: 1 },
      async files => [...files.map(file => ({ file })), { file: linked }])
      .then(() => null, (error: unknown) => error);
    expect(failed).toMatchObject({ code: "NOT_FOUND" });
    expect((await fixture.service.getBranch(scope)).revision).toBe(1);
    expect((await fixture.service.listFiles(scope)).map(file => file.path)).toEqual(["main.tex"]);
  } finally { fault.mockRestore(); }
});
