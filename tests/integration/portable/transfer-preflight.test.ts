import { test } from "bun:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, foundationMigrations, loadConfig } from "@quire/runtime";
import { modules } from "../../../apps/server/src/composition";
import { transferQuiesced } from "../../../apps/server/src/transfer";
import { topology } from "./topology";

test("offline transfer rejects named pending work and supports the runtime-held configured key", async () => {
  const root = await mkdtemp(join(tmpdir(), "quire-p1s-integrate-preflight-"));
  let source: Awaited<ReturnType<typeof createRuntime>> | undefined;
  try {
    source = await createRuntime(loadConfig({ QUIRE_DATA_DIR: root }), {
      foundation: [...await foundationMigrations(), ...modules.flatMap(module => module.migrations ?? [])],
    });
    await using cluster = await topology(Buffer.from(source.secretKey).toString("hex"));
    const target = await cluster.createController();
    try {
      await assert.rejects(transferQuiesced(source, target, false), { code: "TRANSFER_QUIESCENCE_REQUIRED" });
      const id = crypto.randomUUID();
      await source.db.run("INSERT INTO core_git_intents(id,payload_json,created_at) VALUES(?,?,?)",
        [id, "{}", source.clock.now()]);
      await assert.rejects(transferQuiesced(source, target, true), { code: "TRANSFER_RECOVERY_REQUIRED" });
      assert.equal(await target.db.get("SELECT id FROM core_git_intents"), null);
      await source.db.run("DELETE FROM core_git_intents WHERE id=?", [id]);
      // The bound key is authoritative when configuration supplied it without a file.
      await rm(join(root, "secret.key"), { force: true });
      const receipt = await transferQuiesced(source, target, true);
      assert.equal(receipt.repositories, 0);
      assert.equal(receipt.blobs, 0);
      assert.deepEqual(receipt.nativeMigrations, await source.db.all("SELECT * FROM schema_migrations ORDER BY id"));
      console.info("TRANSFER_PREFLIGHT_PASSED");
    } finally { await target.close(); }
  } finally {
    if (source) await source.close();
    await rm(root, { recursive: true, force: true });
    console.info("TRANSFER_PREFLIGHT_SOURCE_CLEANED", root);
  }
}, 120000);
