import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { InstantSchema } from "@quire/contracts";
import { createRuntime, loadConfig } from "@quire/runtime";
import { modules } from "../../../apps/server/src/composition";
import { register, migrations, configureBackups } from "../../../services/operations/backups";
import { seed } from "../../../scripts/seed";
import { stopWorker } from "../../../services/compiler";
import { dispose as disposeReview } from "../../../services/core/review";

export const password = "quire-backup-owned-fixture-2026";
export const backupModules = [
  ...modules.filter(module => module.id !== "041-o-backups"),
  { id: "041-o-backups", lane: "O", order: 41, register, migrations },
] as const;

export async function backupFixture() {
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-backup-"));
  console.info("BACKUP_FIXTURE_CREATED", root);
  const backupRoot = join(root, "backups");
  const restoreRoot = join(root, "restores");
  await mkdir(backupRoot, { mode: 0o700 });
  await mkdir(restoreRoot, { mode: 0o700 });
  let now = "2026-10-27T07:00:00.000Z";
  const clock = { now: () => InstantSchema.parse(now) };
  const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: join(root, "source") }), { modules: backupModules, clock });
  const gate = runtime.admission;
  const signingKey = generateKeyPairSync("ed25519").privateKey;
  configureBackups(runtime, {
    backupRoot, restoreRoot, signingKey, configuration: { fixture: "complete", mailDelivery: "local" },
    exclusive: work => gate.exclusive(work),
    openFresh: target => createRuntime(loadConfig({ QUIRE_DATA_DIR: target }), {
      clock, modules: backupModules.map(module => ({ ...module, register: () => {} })),
    }),
  });
  try { await gate.writer(() => seed(runtime, password)); }
  catch (error) {
    await stopWorker(runtime); await disposeReview(runtime); await runtime.close();
    await rm(root, { recursive: true }); throw error;
  }
  const request = (path: string, input: { readonly headers?: HeadersInit; readonly body?: unknown; readonly method?: string } = {}) => {
    const headers = new Headers(input.headers);
    headers.set("origin", "http://localhost:5173");
    headers.set("content-type", "application/json");
    headers.set("idempotency-key", headers.get("idempotency-key") ?? crypto.randomUUID());
    const operation = () => runtime.routes.fetch(new Request(`http://localhost:5173${path}`, {
      method: input.method ?? (input.body === undefined ? "GET" : "POST"), headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    }));
    // Backup control requests authenticate before entering exclusive maintenance.
    return path.startsWith("/api/admin/backups") ? operation() : gate.writer(operation);
  };
  const context = { ...runtime, routes: runtime.routes.forLane("O") };
  return {
    root, runtime, context, request, gate, backupRoot, restoreRoot, signingKey,
    setTime(value: string) { now = InstantSchema.parse(value); },
    [Symbol.asyncDispose]: async () => {
      await stopWorker(runtime);
      await disposeReview(runtime);
      await runtime.close();
      await rm(root, { recursive: true });
      console.info("BACKUP_FIXTURE_CLEANED", root);
    },
  };
}
