import { z } from "zod";
import { endpoints, HistoryVersionSchema, OkSchema, FileEntrySchema, IdSchema, resourceVersionTag, assertNever } from "@quire/contracts";
import type { Id, FileEntry } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { sourceZip } from "../base";
import type { HistoryStore } from "./history-store";
import { compare, fail, uuid, page } from "./store";
import { finishRestores } from "./recovery";
import { finishDecisions } from "./decisions";

export function registerHistory(context: ModuleContext, store: HistoryStore): () => void {
  finishRestores(store);
  finishDecisions(store);
  store.captureMissing();
  const unsubscribe = context.events.subscribe(event => {
    switch (event.topic) {
      case "tree.changed":
        finishDecisions(store);
        finishRestores(store);
        store.captureMissing(event.aggregateId);
        queueMicrotask(() => context.events.dispatch());
        return;
      case "document.saved":
      case "access.changed":
      case "review.changed":
      case "history.created":
      case "git.changed":
      case "job.changed":
      case "operation.changed":
      case "notification.created":
      case "policy.changed":
      case "session.revoked": return;
      default: assertNever(event);
    }
  });
  context.routes.register(endpoints.historyList, async (input, request) => {
    const scope = { projectId: input.params.p, branch: input.query.branch };
    const actorId = await store.read(request, scope);
    store.captureMissing(scope.projectId);
    const rows = context.db.query<{ id: Id }, [string, string]>(`SELECT h.id FROM history_versions h
      JOIN snapshots s ON s.id=h.snapshot_id WHERE s.project_id=? AND s.branch=? ORDER BY s.rowid DESC`)
      .all(scope.projectId, scope.branch);
    const items = await Promise.all(rows.map(row => store.dto(row.id, scope, actorId)));
    store.version(request, store.projects.getBranch(scope).revision);
    return page(items.filter(item => input.query.labelsOnly !== "true" || item.labels.length), input.query);
  });
  context.routes.register(endpoints.historyLabel, async (input, request) => {
    const row = store.record(input.params.id, input.params.p);
    const scope = row.snapshot.scope;
    const actorId = await store.write(request, scope, "write");
    await store.accessible(row.id, scope, actorId);
    const dto = await store.dto(row.id, scope, actorId);
    return store.mutate({ actorId, request, scope, route: "historyLabel", body: input, schema: HistoryVersionSchema, work: () => {
      const current = store.record(row.id, scope.projectId);
      compare(current.version, input.body.expectedVersion);
      const label = { id: uuid(), name: z.string().trim().min(1).parse(input.body.name) };
      context.db.query("INSERT INTO version_labels(id,history_version_id,name,author_id,created_at) VALUES(?,?,?,?,?)")
        .run(label.id, row.id, label.name, actorId, context.clock.now());
      context.db.query("UPDATE history_versions SET version=version+1 WHERE id=?").run(row.id);
      store.version(request, current.version + 1);
      return { ...dto, version: current.version + 1, labels: [...dto.labels, label] };
    } });
  });
  context.routes.register(endpoints.historyLabelDelete, async (input, request) => {
    const row = store.record(input.params.id, input.params.p);
    const scope = row.snapshot.scope;
    const actorId = await store.write(request, scope, "write");
    await store.accessible(row.id, scope, actorId);
    return store.mutate({ actorId, request, scope, route: "historyLabelDelete", body: input, schema: OkSchema, work: () => {
      const current = store.record(row.id, scope.projectId);
      compare(current.version, input.body.expectedVersion);
      if (!context.db.query("SELECT 1 FROM version_labels WHERE id=? AND history_version_id=?").get(input.params.labelId, row.id)) {
        fail("NOT_FOUND", 404, "Label not found");
      }
      context.db.query("DELETE FROM version_labels WHERE id=?").run(input.params.labelId);
      context.db.query("UPDATE history_versions SET version=version+1 WHERE id=?").run(row.id);
      return { ok: true, version: current.version + 1 };
    } });
  });
  context.routes.register(endpoints.historySource, async (input, request) => {
    const scope = { projectId: input.params.p, branch: input.query.branch };
    const actorId = await store.read(request, scope);
    const version = await store.accessible(input.params.id, scope, actorId);
    request.responseHeaders.set("content-type", "application/zip");
    request.responseHeaders.set("content-disposition", `attachment; filename="source-${version.id}.zip"`);
    return new Uint8Array(await sourceZip(store.projects, version.snapshot));
  });
  context.routes.register(endpoints.historyCompare, async (input, request) => {
    const scope = { projectId: input.params.p, branch: input.query.branch };
    const actorId = await store.read(request, scope);
    const from = await store.accessible(input.query.from, scope, actorId);
    const to = await store.accessible(input.query.to, scope, actorId);
    const left = (await store.projects.readSnapshot(from.snapshot.id)).files;
    const right = (await store.projects.readSnapshot(to.snapshot.id)).files;
    const ids = new Set([...left, ...right].map(file => file.id));
    const files: FileEntry[] = [];
    const hunks = [];
    for (const id of ids) {
      if (input.query.fileId && input.query.fileId !== id) continue;
      const before = left.find(file => file.id === id);
      const after = right.find(file => file.id === id);
      if (before?.blob === after?.blob && before?.path === after?.path) continue;
      const file = after ?? before;
      if (!file) continue;
      files.push(file);
      if (!(before?.editable || after?.editable)) continue;
      const oldText = before?.blob ? new TextDecoder().decode(await context.blobs.get(before.blob)) : "";
      const newText = after?.blob ? new TextDecoder().decode(await context.blobs.get(after.blob)) : "";
      hunks.push({ id: uuid(), fileId: id, path: file.path, baseHead: from.snapshot.tree,
        baseRevision: from.snapshot.revision, oldStart: oldText ? 1 : 0,
        oldLines: oldText ? oldText.split("\n").length - Number(oldText.endsWith("\n")) : 0,
        newStart: newText ? 1 : 0, newLines: newText ? newText.split("\n").length - Number(newText.endsWith("\n")) : 0,
        before: oldText, after: newText, staged: false });
    }
    const authors = context.db.query<{ author_id: Id }, [string, string, number, number]>(
      `SELECT DISTINCT author_id FROM snapshots WHERE project_id=? AND branch=? AND revision BETWEEN ? AND ? ORDER BY author_id`)
      .all(scope.projectId, scope.branch, Math.min(from.snapshot.revision, to.snapshot.revision),
        Math.max(from.snapshot.revision, to.snapshot.revision));
    return { files, hunks, authors: [...new Set([...from.authors, ...to.authors, ...authors.map(row => row.author_id)])] };
  });
  context.routes.register(endpoints.historyRestore, async (input, request) => {
    const scope = store.scope(input.params.p, input.body.scope);
    const actorId = await store.write(request, scope, "history.restore");
    const target = await store.accessible(input.params.id, scope, actorId);
    const key = request.request.headers.get("idempotency-key");
    if (!key) fail("IDEMPOTENCY_KEY_REQUIRED", 400, "Idempotency-Key required");
    const route = `historyRestore:${scope.projectId}:${scope.branch}`;
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex");
    return store.projects.serialized(scope, async () => {
      await store.actor(request);
      await store.projects.authorize(actorId, scope, "history.restore");
      const cached = context.db.query<{ request_digest: string; response_json: string }, [string, string, string]>(
        "SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?").get(actorId, key, route);
      if (cached) {
        if (cached.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Restore key has different input");
        const receipt = z.object({ revision: z.number() }).parse(JSON.parse(cached.response_json));
        const restored = z.object({ id: IdSchema }).parse(context.db.query(`SELECT id FROM snapshots
          WHERE project_id=? AND branch=? AND revision=? AND reason='restore'`).get(scope.projectId, scope.branch, receipt.revision));
        finishRestores(store);
        request.responseHeaders.set("etag", resourceVersionTag(receipt.revision));
        return store.dto(restored.id, scope, actorId);
      }
      const branch = store.projects.getBranch(scope);
      compare(branch.revision, input.body.expectedVersion);
      const prior = (await store.projects.readSnapshot(target.snapshot.id)).files;
      const live = store.projects.listFiles(scope);
      const selected = input.body.fileIds;
      if (selected && (!selected.length || selected.some(id => !prior.some(file => file.id === id)))) fail("NOT_FOUND", 404, "Restore file not in version");
      const next = selected ? [...live.filter(file => !selected.includes(file.id)), ...prior.filter(file => selected.includes(file.id))] : prior;
      const inputs = await Promise.all(next.map(async file => {
        if (selected && !selected.includes(file.id)) return { file };
        const current = live.find(item => item.id === file.id);
        const tombstone = z.object({ epoch: z.number() }).nullable().parse(context.db.query(
          "SELECT epoch FROM files WHERE id=? AND branch_id=?").get(file.id, branch.id));
        const restored = FileEntrySchema.parse({ ...file, version: { revision: branch.revision + 1,
          epoch: Math.max(current?.version.epoch ?? tombstone?.epoch ?? 0, file.version.epoch) + 1 } });
        return { file: restored, ...(file.blob ? { bytes: await context.blobs.get(file.blob) } : {}) };
      }));
      const plan = { scope, historyId: target.id, fileIds: selected ?? null, expectedRevision: branch.revision, actorId, key, route, digest };
      context.uow.local(tx => tx.query("INSERT OR REPLACE INTO review_restore_intents(id,payload_json) VALUES(?,?)")
        .run(`${actorId}:${route}:${key}`, JSON.stringify(plan)));
      const snapshot = await store.projects.commitSource({ actorId, scope, expectedRevision: branch.revision, inputs, reason: "restore",
        receipt: { actorId, key, route, digest, response: JSON.stringify({ id: target.id, revision: branch.revision + 1 }) } });
      finishRestores(store);
      store.capture(snapshot);
      request.responseHeaders.set("etag", resourceVersionTag(snapshot.revision));
      return store.dto(snapshot.id, scope, actorId);
    });
  });
  return unsubscribe;
}
