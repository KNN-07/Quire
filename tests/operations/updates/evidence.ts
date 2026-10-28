import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import ky from "ky";
import { fixture } from "./fixture";

export async function captureEvidence(): Promise<void> {
  for (const scenario of ["accept", "migration-failure"] as const) {
    let ownedRoot = "";
    {
      await using f = await fixture();
      ownedRoot = f.root;
      if (scenario === "migration-failure") f.failMigration();
      const queued = await f.schedule();
      await f.service.tick();
      const operation = await f.service.store.operation(queued.id);
      assert.equal(operation.status, scenario === "accept" ? "succeeded" : "failed");
      const applicationUpdates = await f.runtime.db.all("SELECT * FROM operations WHERE kind='update'");
      assert.deepEqual(applicationUpdates, []);
      console.log(JSON.stringify({
        scenario, operation, ownedRoot, document: f.document(), migrated: f.migrated(),
        control: f.control.state(), receipt: f.control.receipt(queued.id),
        intents: f.control.intents(queued.id), applicationUpdates,
        scope: "independent ledger and real signature/package/SQLite contract fixture; not configured host acceptance",
      }));
      if (scenario === "accept") {
        const configPath = join(f.root, "operator-config.json");
        await writeFile(configPath, JSON.stringify(f.config), { flag: "wx", mode: 0o600 });
        const command = [process.execPath, "scripts/ops/update.ts", "validate", configPath];
        const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        assert.equal(exit, 0, stderr);
        console.log(JSON.stringify({ command, exit, stdout, stderr }));
        console.log(JSON.stringify({
          publicKey: f.config.trustKeyPem,
          envelope: await ky.get(f.config.feedUrl, { retry: 0, timeout: 10_000 }).json(),
          package: await ky.get(new URL("/package", f.config.feedUrl), { retry: 0, timeout: 10_000 }).text(),
        }));
      } else {
        assert.equal(f.migrated(), null);
        assert.deepEqual(f.document(), { body: "retained source" });
      }
    }
    assert.equal(existsSync(ownedRoot), false);
    console.log(`CLEANED ${ownedRoot}: exact owned temporary root absent after all fixture handles closed`);
  }
}
if (import.meta.main) await captureEvidence();
