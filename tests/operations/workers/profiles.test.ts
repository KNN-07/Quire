import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvironmentSchema } from "@quire/contracts";
import { createRuntime, loadConfig } from "@quire/runtime";
import { migrations } from "../../../services/operations/workers";
import { poolEnvironments } from "../../../services/operations/workers/profiles";
import { migrations as environmentMigrations } from "../../../services/operations/environments";

test("a Docker pool rejects available-looking manifests without an executed probe receipt", async () => {
  // Given deliberately untrusted registry metadata, not an actual verified image.
  await using resources = new AsyncDisposableStack();
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-workers-profiles-"));
  resources.defer(() => rm(root, { recursive: true, force: true }));
  const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: root }), {
    modules: [
      { id: "060-o-environments", lane: "O", order: 60, migrations: environmentMigrations, register: () => undefined },
      { id: "080-o-workers", lane: "O", order: 80, migrations, register: () => undefined },
    ],
  });
  resources.defer(() => runtime.close());
  const manifest = EnvironmentSchema.parse({
    id: crypto.randomUUID(), label: "Untrusted attack fixture", release: "2025", backend: "docker",
    rootOrImageDigest: `sha256:${"0".repeat(64)}`, packagesDigest: "0".repeat(64),
    engines: ["pdflatex"], helpers: ["bibtex", "biber", "synctex"],
    experimental: true, available: true, probeAt: runtime.clock.now(),
  });
  await runtime.db.run(`INSERT INTO environments(id,label,release,backend,manifest_json,available,probe_at,created_at)
    VALUES(?,?,?,?,?,1,?,?)`, [manifest.id, manifest.label, manifest.release, manifest.backend,
    JSON.stringify(manifest), manifest.probeAt, runtime.clock.now()]);
  // When pool provisioning resolves the apparent Docker environment.
  const rejected = await poolEnvironments(runtime, { backend: "docker" }).then(() => null, (error: unknown) => error);
  // Then no role is provisioned from metadata alone.
  expect(rejected).toMatchObject({ code: "ENVIRONMENT_UNTRUSTED" });
  expect(await runtime.db.all("SELECT * FROM o_worker_processes")).toEqual([]);
});
