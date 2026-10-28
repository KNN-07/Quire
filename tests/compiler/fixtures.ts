import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { IdSchema, DigestSchema, FileEntrySchema, SnapshotSchema } from "@quire/contracts";
import type { CompileSettings, BlobStore, ProjectPort, Id } from "@quire/contracts";
import { createRuntime, loadConfig, ServiceError } from "@quire/runtime";
import type { RuntimeOptions } from "@quire/runtime";
import { seed } from "../../scripts/seed";
import { fixtureIds as ids, defaultPolicy } from "../fixtures/foundation";
import { register, migrations, startWorker, stopWorker } from "../../services/compiler";
import { CompilerStore } from "../../services/compiler/store";
import { register as registerIdentity, migrations as identityMigrations } from "../../services/accounts/identity";
import { register as registerCore, migrations as coreMigrations } from "../../services/core/base";
import { register as governance, migrations as governanceMigrations } from "../../services/accounts/governance";
export { fixtureIds } from "../fixtures/foundation";
export const mainId = ids.mainFile;
export const environmentId = ids.environment;
export const settings: CompileSettings = {
  engine: "pdflatex", mainFileId: mainId, environmentId, draft: false, stopOnFirstError: true,
};
export function sourceFixture(source: string, extra: Readonly<Record<string, string>> = {}) {
  const blobs = new Map<string, Uint8Array>();
  const files = Object.entries({ "main.tex": source, ...extra }).map(([path, text], index) => {
    const bytes = new TextEncoder().encode(text);
    const digest = DigestSchema.parse(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
    blobs.set(digest, bytes);
    return FileEntrySchema.parse({ id: index === 0 ? mainId : crypto.randomUUID(),
      path, kind: "file", mime: "text/plain", blob: digest, bytes: bytes.length, editable: true,
      version: { revision: 0, epoch: 0 }, link: null });
  });
  const store: BlobStore = {
    put: async (bytes) => {
      const digest = DigestSchema.parse(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
      blobs.set(digest, bytes); return digest;
    },
    get: async (digest) => {
      const bytes = blobs.get(digest);
      if (!bytes) throw new TypeError("Fixture blob missing");
      return bytes;
    },
  };
  return { files, blobs: store };
}
export const fixturePassword = "compiler-test-password-2026";
export async function compilerFixture(options: { readonly integrated?: boolean; readonly wallSeconds?: number; readonly createAdapters?: RuntimeOptions["createAdapters"]; readonly clock?: RuntimeOptions["clock"] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "quire-compiler-suite-"));
  const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: root }), {
    ...(options.createAdapters ? {createAdapters:options.createAdapters} : {}),
    ...(options.clock ? { clock: options.clock } : {}),
    modules: [
      { id: "010-a-identity", lane: "A", order: 10, register: registerIdentity, migrations: identityMigrations },
      ...(options.integrated ? [
        { id: "011-a-governance", lane: "A", order: 11, register: governance, migrations: governanceMigrations },
        { id: "020-k-core", lane: "K", order: 20, register: registerCore, migrations: coreMigrations },
      ] as const : []),
      { id: "030-c-compiler", lane: "C", order: 30, register, migrations },
    ],
  });
  const cleanups = new Set<() => void>();
  await seed(runtime, fixturePassword);
  const store = new CompilerStore({ ...runtime, routes: runtime.routes.forLane("C") });
  let currentSnapshot = ids.snapshot;
  const projects: ProjectPort = {
    authorize: async (actor, scope) => {
      if (actor !== ids.kien || scope.projectId !== ids.project || scope.branch !== "main") throw new ServiceError("FORBIDDEN", 403, "Fixture denies this actor");
    },
    authorizeRequest: async (request, scope, action) => {
      const principal = await runtime.services.get("identity").require(request);
      await projects.authorize(principal.user.id, scope, action);
      return principal.user.id;
    },
    snapshot: async (actor, scope, revision) => {
      await projects.authorize(actor, scope, "compile");
      const snapshot = (await store.snapshot(currentSnapshot));
      if (snapshot.revision !== revision) throw new ServiceError("REVISION_CONFLICT", 409, "Fixture revision changed");
      return snapshot;
    },
    readSnapshot: async (id) => ({
      tree: (await store.snapshot(id)).tree,
      files: (await runtime.db.all(`SELECT file_id AS id,path,kind,mime,blob,bytes,editable,revision,epoch,link_json
        FROM snapshot_files WHERE snapshot_id=?`, [id])).map((value) => {
          const row = z.object({ editable: z.number(), revision: z.number(), epoch: z.number(), link_json: z.string().nullable() }).passthrough().parse(value);
          const { revision, epoch, link_json, ...rest } = row;
          return FileEntrySchema.parse({ ...rest, editable: !!row.editable, version: { revision, epoch },
            link: link_json ? JSON.parse(link_json) : null });
        }),
    }),
    applyEdits: async () => { throw new ServiceError("FIXTURE_READ_ONLY", 405, "Compiler fixture does not implement editing"); },
  };
  if (!options.integrated) runtime.services.provide("projects", projects);
  if (options.wallSeconds !== undefined) await runtime.db.run(
    "UPDATE account_project_benefits SET benefits_json=? WHERE scope_kind='deployment'",
    [JSON.stringify({ compileSeconds: options.wallSeconds, writableMembers: defaultPolicy.writableMembers,
      historyDays: defaultPolicy.historyDays, trackChanges: defaultPolicy.trackChanges })]);
  const replaceSnapshot = async (source: string) => {
    const blob = await runtime.blobs.put(new TextEncoder().encode(source));
    const id = IdSchema.parse(crypto.randomUUID());
    const previous = (await store.snapshot(currentSnapshot));
    const snapshot = SnapshotSchema.parse({ ...previous, id, revision: previous.revision + 1, reason: "compile" });
    (await runtime.db.run("INSERT OR IGNORE INTO blobs(digest,bytes,created_at) VALUES(?,?,?)", [blob, source.length, runtime.clock.now()]));
    (await runtime.db.run("INSERT INTO snapshots(id,project_id,branch,revision,tree,author_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?)", [id, ids.project, "main", snapshot.revision, snapshot.tree, ids.kien, "compile", runtime.clock.now()]));
    (await runtime.db.run(`INSERT INTO snapshot_files(snapshot_id,file_id,path,kind,mime,blob,bytes,editable,revision,epoch)
      VALUES(?,?,'main.tex','file','text/x-tex',?,?,1,?,0)`, [id, mainId, blob, source.length, snapshot.revision]));
    currentSnapshot = id;
    return snapshot;
  };
  return { ...runtime, store, replaceSnapshot, cleanups, start: () => startWorker(runtime),
    [Symbol.asyncDispose]: async () => {
      await stopWorker(runtime);
      for (const cleanup of cleanups) cleanup();
      await runtime.close(); await rm(root, { recursive: true, force: true });
    } };
}
export function terminalEvent(runtime: Awaited<ReturnType<typeof compilerFixture>>, id?: Id) {
  const result = Promise.withResolvers<Id>();
  const cleanup = () => { clearTimeout(timeout); unsubscribe(); runtime.cleanups.delete(cleanup); };
  const timeout = setTimeout(() => { cleanup(); result.reject(new TypeError("Compile event timed out")); }, 180000);
  const unsubscribe = runtime.events.subscribe((event) => {
    if (event.topic === "job.changed" && (!id || event.payload.resourceId === id) &&
      !["queued", "running"].includes(event.payload.status)) {
      cleanup(); result.resolve(event.payload.resourceId);
    }
  });
  runtime.cleanups.add(cleanup);
  return result.promise;
}
