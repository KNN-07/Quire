import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { rejects } from "node:assert/strict";
import { createApplication } from "../../../apps/server/src/composition";
import { createScaleAdapters, loadScaleConfig } from "../../../apps/server/src/scale";
import type { RuntimeAdapters } from "@quire/runtime";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { RemoteRepositoryService } from "../../../services/operations/repository";
import { exportDatabase } from "../../../services/operations/backups/database";
import { restoreTargetScaleFixture } from "../../operations/backups/restore-target-scale-fixture";
import { fixture } from "./fixture";

test("real PostgreSQL prepared storage verifies without writes and activates the real Redis/S3/repository factory", async () => {
  await using native = await fixture({ modules: [], adapters: false });
  const key = crypto.getRandomValues(new Uint8Array(32));
  await using scale = await restoreTargetScaleFixture(key);
  const source = await scale.open("source");
  const config = { ...source.runtime.config, compilerBackend: "docker" as const };
  const settings = loadScaleConfig(source.configuration);
  const before = await exportDatabase(source.runtime);
  const bytes = new TextEncoder().encode("actual S3 prepared binding");
  const digest = await source.runtime.blobs.put(bytes);
  let opened = 0;
  let activated = 0;
  let disposed = 0;
  const backups = { signingKey: generateKeyPairSync("ed25519").privateKey,
    backupRoot: native.root + "/backups", restoreRoot: native.root + "/restores" };
  await rejects(createApplication({ config, startup: "prepared", adapters: false, backups }),
    { code: "PREPARED_ADAPTERS_REQUIRED" });
  const app = await createApplication({ config, startup: "prepared", adapters: false, backups,
    prepareAdapters: async (runtimeConfig, clock) => {
      const storage = await createPostgresStorage({ url: settings.postgresUrl });
      opened++;
      let active: RuntimeAdapters | undefined;
      return {
        db: storage.db,
        async activate() {
          activated++;
          await storage.close();
          active = await createScaleAdapters(runtimeConfig, clock, settings);
          return active;
        },
        async dispose() {
          disposed++;
          if (active) await active.close();
          await storage.close();
        },
      };
    },
  });
  try {
    expect((await app.check()).database).toBe("postgres");
    expect(opened).toBe(1);
    expect(activated).toBe(0);
    expect(await exportDatabase(source.runtime)).toEqual(before);
    expect((await app.fetch(new Request("http://prepared.test/api/health"))).status).toBe(503);
    await Promise.all([app.start(), app.activate()]);
    expect(activated).toBe(1);
    expect((await app.fetch(new Request("http://prepared.test/api/health"))).status).toBe(200);
    expect(await app.runtime.blobs.get(digest)).toEqual(bytes);
    const repositories = app.runtime.repositories;
    if (!(repositories instanceof RemoteRepositoryService)) throw new Error("Actual remote repository required");
    expect(await repositories.restoreIdentity()).toBeDefined();
  } finally { await app.dispose(); }
  expect(disposed).toBe(1);
}, 300000);
