import { test } from "bun:test";
import { strict as assert } from "node:assert";
import { DigestSchema } from "@quire/contracts";
import { seed } from "../../../scripts/seed";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { topology } from "./topology";

test("fresh scale seed uses PostgreSQL S3 and the remote repository journal and is idempotent", async () => {
  await using cluster = await topology();
  const runtime = await cluster.createController();
  try {
    const result = await seed(runtime, "p1s-fresh-scale-seed-password");
    assert.equal(result.createdUsers, 6);
    assert.deepEqual(await seed(runtime), { createdUsers: 0, password: null });
    assert.equal(runtime.db.dialect, "postgres");
    const row = await runtime.db.get<{ blob: string }>("SELECT blob FROM files WHERE id=?", [ids.mainFile]);
    assert.ok(row);
    const head = new TextDecoder().decode(await runtime.repositories.read(ids.project, ["show", "refs/heads/main:main.tex"]));
    const expected = await Bun.file(new URL("../../fixtures/example/main.tex", import.meta.url)).text();
    assert.equal(head, expected);
    assert.equal(new TextDecoder().decode(await runtime.blobs.get(DigestSchema.parse(row.blob))), expected);
    assert.equal(await runtime.db.get("SELECT id FROM repository_intents WHERE state<>'finalized'"), null);
    assert.equal((await runtime.db.all("SELECT id FROM users")).length, 6);
    console.info("FRESH_SCALE_SEED_PASSED", { users: result.createdUsers, sourceBytes: new TextEncoder().encode(head).length });
  } finally { await runtime.close(); }
  await cluster.redisStop();
  await cluster.redisStart();
  const replacement = await cluster.createController();
  try {
    assert.equal(replacement.db.dialect, "postgres");
    assert.equal((await replacement.db.all("SELECT id FROM users")).length, 6);
    assert.equal(new TextDecoder().decode(await replacement.repositories.read(ids.project,
      ["show", "refs/heads/main:main.tex"])), await Bun.file(new URL("../../fixtures/example/main.tex", import.meta.url)).text());
    console.info("NEW_FACTORY_AFTER_REDIS_RESTART_PASSED");
  } finally { await replacement.close(); }
}, 120000);
