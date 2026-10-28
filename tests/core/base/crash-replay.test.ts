import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { FileEntrySchema, OperationSchema, IdSchema } from "@quire/contracts";
import type { Transaction, SqlValue } from "@quire/contracts";
import { baseFixture, projectEnvelope } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

type Fixture = Awaited<ReturnType<typeof baseFixture>>;
function crashAt(fixture: Fixture, boundary: "before-receipt" | "after-commit") {
  if (boundary === "before-receipt") {
    const run = fixture.runtime.uow.run.bind(fixture.runtime.uow);
    let armed = true;
    return spyOn(fixture.runtime.uow, "run").mockImplementation(async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
      return run(tx => work({
        transaction: true, dialect: tx.dialect, lock: tx.lock.bind(tx),
        get: tx.get.bind(tx), all: tx.all.bind(tx), query: tx.query.bind(tx),
        execute: tx.execute.bind(tx), exec: tx.exec.bind(tx),
        run: async (sql: string, parameters?: readonly SqlValue[]) => {
          if (armed && sql.includes("INSERT INTO idempotency_results")) {
            armed = false;
            throw new Error("Injected crash after source writes before receipt insert");
          }
          return tx.run(sql, parameters);
        },
      }));
    });
  }
  const dispatch = fixture.runtime.events.dispatch.bind(fixture.runtime.events);
  return spyOn(fixture.runtime.events, "dispatch").mockImplementationOnce(async () => {
    await dispatch();
    throw new Error("Injected crash after aggregate commit before handler return");
  });
}

test.each(["before-receipt", "after-commit"] as const)(
  "project creation recovers %s without a second aggregate", async boundary => {
    await using fixture = await baseFixture();
    const owner = await fixture.login();
    const key = crypto.randomUUID();
    const headers = { ...owner.headers, "idempotency-key": key };
    const body = JSON.stringify({ name: `Crash ${boundary}`, origin: { kind: "blank" } });
    const fault = crashAt(fixture, boundary);
    try {
      expect((await fixture.request("/api/projects", { method: "POST", headers, body })).status).toBe(500);
    } finally { fault.mockRestore(); }
    const projects = await fixture.runtime.db.all<{ id: string }>("SELECT id FROM projects WHERE name=?", [`Crash ${boundary}`]);
    expect(projects).toHaveLength(1);
    const receipts = await fixture.runtime.db.all("SELECT key FROM idempotency_results WHERE actor_id=? AND key=? AND route='projectCreate'",
      [owner.user.id, key]);
    expect(receipts).toHaveLength(boundary === "after-commit" ? 1 : 0);
    await fixture.restart();
    const response = await fixture.request("/api/projects", { method: "POST", headers, body });
    const project = projectEnvelope.parse(await response.json()).data;
    expect(project.id).toBe(IdSchema.parse(projects[0]?.id));
    expect(await fixture.runtime.db.all("SELECT id FROM projects WHERE name=?", [`Crash ${boundary}`])).toHaveLength(1);
    expect(await fixture.runtime.db.all("SELECT id FROM snapshots WHERE project_id=?", [project.id])).toHaveLength(1);
    expect(await fixture.runtime.db.all("SELECT id FROM base_source_intents")).toHaveLength(0);
    expect((await fixture.service.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId)).text)
      .toContain("\\documentclass");
    const retry = await fixture.request("/api/projects", { method: "POST", headers, body });
    expect(projectEnvelope.parse(await retry.json()).data).toEqual(project);
  });

test.each(["before-receipt", "after-commit"] as const)(
  "file creation recovers %s without a second source revision", async boundary => {
    await using fixture = await baseFixture();
    const owner = await fixture.login();
    const scope = { projectId: ids.project, branch: "main" };
    const revision = (await fixture.service.getBranch(scope)).revision;
    const snapshots = await fixture.runtime.db.all("SELECT id FROM snapshots WHERE project_id=?", [ids.project]);
    const headers = { ...owner.headers, "idempotency-key": crypto.randomUUID() };
    const body = JSON.stringify({ scope, path: "crash.txt", kind: "file", text: "once", expectedVersion: revision });
    const fault = crashAt(fixture, boundary);
    try {
      expect((await fixture.request(`/api/projects/${ids.project}/files`, { method: "POST", headers, body })).status).toBe(500);
    } finally { fault.mockRestore(); }
    await fixture.restart();
    const response = await fixture.request(`/api/projects/${ids.project}/files`, { method: "POST", headers, body });
    const file = z.object({ data: FileEntrySchema }).parse(await response.json()).data;
    expect(file.path).toBe("crash.txt");
    expect((await fixture.service.getBranch(scope)).revision).toBe(revision + 1);
    expect(await fixture.runtime.db.all("SELECT id FROM snapshots WHERE project_id=?", [ids.project]))
      .toHaveLength(snapshots.length + 1);
    expect((await fixture.service.listFiles(scope)).filter(entry => entry.path === "crash.txt")).toHaveLength(1);
    expect((await fixture.service.readDocument(scope, file.id)).text).toBe("once");
    expect(await fixture.runtime.db.all("SELECT id FROM base_source_intents")).toHaveLength(0);
    expect(await fixture.runtime.db.all("SELECT id FROM repository_intents WHERE state<>'finalized'")).toHaveLength(0);
  });

test("bulk operation commits dashboard state and HTTP receipt before dispatch", async () => {
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const headers = { ...owner.headers, "idempotency-key": crypto.randomUUID() };
  const body = JSON.stringify({ items: [{ id: ids.project, expectedVersion: 0 }], action: "archive" });
  const fault = crashAt(fixture, "after-commit");
  try {
    expect((await fixture.request("/api/projects/bulk", { method: "POST", headers, body })).status).toBe(500);
  } finally { fault.mockRestore(); }
  await fixture.restart();
  const response = await fixture.request("/api/projects/bulk", { method: "POST", headers, body });
  const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
  expect(operation.status).toBe("succeeded");
  expect((await fixture.service.getProject(ids.project)).version).toBe(1);
  expect(await fixture.runtime.db.all("SELECT id FROM operations WHERE idempotency_key=?", [headers["idempotency-key"]])).toHaveLength(1);
});

test("multipart replay preserves the original database file ordering", async () => {
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const headers = { ...owner.headers, "idempotency-key": crypto.randomUUID() };
  const form = new FormData();
  form.set("scope", JSON.stringify({ projectId: ids.project, branch: "main" }));
  form.set("expectedVersion", "0");
  form.set("paths", JSON.stringify(["z.txt", "a.txt"]));
  form.append("files", new File(["last"], "z.txt"));
  form.append("files", new File(["first"], "a.txt"));
  const schema = z.object({ data: z.array(FileEntrySchema) });
  const first = await fixture.request(`/api/projects/${ids.project}/uploads`, { method: "POST", headers, body: form });
  const original = schema.parse(await first.json()).data;
  expect(original.map(file => file.path)).toEqual(["a.txt", "z.txt"]);
  await fixture.restart();
  const retry = await fixture.request(`/api/projects/${ids.project}/uploads`, { method: "POST", headers, body: form });
  expect(schema.parse(await retry.json()).data).toEqual(original);
});
