import { strict as assert } from "node:assert";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createPublicKey } from "node:crypto";
import { z } from "zod";
import { IdSchema, ThreadSchema } from "@quire/contracts";
import { createLocalAdapters, createRuntime, loadConfig, loadSecretKey } from "@quire/runtime";
import { createBackup, restoreBackup, restoreConfirmation, verifyBackup } from "../../../services/operations/backups";
import { exportDatabase } from "../../../services/operations/backups/database";
import { exportRepository } from "../../../services/operations/backups/repositories";
import { stopWorker } from "../../../services/compiler";
import { dispose as disposeReview } from "../../../services/core/review";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { backupFixture, backupModules } from "./fixture";
import { compileForDrill } from "./compile-fixture";
import { prepareCompleteData } from "./complete-fixture";
import { command } from "../../integration/portable/process";

export async function completeDrill(evidence: string) {
  await using fixture = await backupFixture();
  const { runtime } = fixture;
  const { headers, thread, comment, threadKey, threadInput, threadStatus, pdf, bytes: pdfBytes } = await prepareCompleteData(fixture);
  // Capture independent source expectations inside the same all-writer exclusion.
  const baseline: { image?: Awaited<ReturnType<typeof exportDatabase>>;
    repository?: Awaited<ReturnType<typeof exportRepository>> } = {};
  const archive = await createBackup(runtime, IdSchema.parse(crypto.randomUUID()), async () => {
    baseline.image = await exportDatabase(runtime);
    baseline.repository = await exportRepository(runtime, ids.project);
  });
  const { image: before, repository } = baseline;
  assert.ok(before);
  assert.ok(repository);
  const verified = await verifyBackup(archive.destination, runtime.secretKey, fixture.signingKey);
  const restored = await restoreBackup(runtime, { archive: archive.destination, target: "complete-drill",
    confirmation: restoreConfirmation(archive.manifest.id, "complete-drill") });
  // Inspect storage before application startup legitimately dispatches its durable outbox.
  const config = loadConfig({ QUIRE_DATA_DIR: restored.destination });
  const target = { ...await createLocalAdapters(config, runtime.clock), config, clock: runtime.clock,
    secretKey: await loadSecretKey(config) };
  try {
    const after = await exportDatabase(target);
    assert.deepEqual(after.tables.filter(table => table.name !== "branch_leases"), before.tables.filter(table => table.name !== "branch_leases"));
    assert.deepEqual(await exportRepository(target, ids.project), repository);
    assert.deepEqual(await target.blobs.get(pdf.sha256), pdfBytes);
    assert.deepEqual(target.secretKey, runtime.secretKey);
    assert.ok(await target.db.get("SELECT id FROM comments WHERE thread_id=?", [thread.id]));
    assert.ok(await target.db.get("SELECT comment_id FROM permanent_comment_tombstones WHERE comment_id=?", [comment.id]));
    assert.ok(await target.db.get("SELECT id FROM history_versions"));
    assert.ok(await target.db.get("SELECT key FROM idempotency_results"));
  } finally { await target.close(); }
  // Reopen through real identity services: existing cookie/CSRF authority must remain usable.
  const reopened = await createRuntime(loadConfig({ QUIRE_DATA_DIR: restored.destination }), { modules: backupModules, clock: runtime.clock });
  let recompiled: Awaited<ReturnType<typeof compileForDrill>>;
  try {
    const response = await reopened.routes.fetch(new Request("http://localhost:5173/api/me", { headers }));
    assert.equal(response.status, 200);
    const restoredMe = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await response.json());
    assert.equal(restoredMe.data.csrfToken, headers["x-csrf-token"]);
    const replay = await reopened.routes.fetch(new Request(`http://localhost:5173/api/projects/${ids.project}/threads`, {
      method: "POST", headers: { ...headers, "idempotency-key": threadKey, origin: "http://localhost:5173",
        "content-type": "application/json" }, body: JSON.stringify(threadInput),
    }));
    assert.equal(replay.status, threadStatus);
    assert.equal(z.object({ data: ThreadSchema }).parse(await replay.json()).data.id, thread.id);
    recompiled = await compileForDrill(reopened);
  } finally { await stopWorker(reopened); await disposeReview(reopened); await reopened.close(); }
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  await writeFile(join(evidence, "restored-output.pdf"), pdfBytes);
  await writeFile(join(evidence, "restored-recompiled-output.pdf"), recompiled.bytes);
  assert.equal(await command(["pdftotext", join(evidence, "restored-recompiled-output.pdf"), "-"]),
    await command(["pdftotext", join(evidence, "restored-output.pdf"), "-"]));
  await writeFile(join(evidence, "manifest.json"), await readFile(join(archive.destination, "manifest.json")));
  await writeFile(join(evidence, "manifest.sig"), await readFile(join(archive.destination, "manifest.sig")));
  await writeFile(join(evidence, "signing-public.pem"), createPublicKey(fixture.signingKey).export({ type: "spki", format: "pem" }));
  await writeFile(join(evidence, "recovery-receipt.json"), JSON.stringify(restored.receipt, null, 2));
  const receipt = { backup: verified.manifest.id, categories: before.tables.map(table => ({ table: table.name, rows: table.rows.length })),
    pdf: { bytes: pdfBytes.length, sha256: pdf.sha256 },
    recompiledPdf: { bytes: recompiled.bytes.length, sha256: recompiled.pdf.sha256, extractedTextEqual: true },
    httpReceiptReplayed: true,
    comments: thread.id, tombstone: comment.id,
    sessionAuthority: "original-cookie-and-csrf-preserved", source: fixture.root, restored: restored.destination };
  await writeFile(join(evidence, "drill.json"), JSON.stringify(receipt, null, 2));
  console.info("COMPLETE_BACKUP_DRILL_PASSED", JSON.stringify(receipt));
  return receipt;
}
