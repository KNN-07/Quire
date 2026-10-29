import { expect, test } from "bun:test";
import { z } from "zod";
import { publisherFixture } from "./harness";
import { prepareSubmission, SubmitResultSchema } from "./assertions";

test("correlates one compiled archive with its explicit submission replay and accepted status", async () => {
  // Given: a real compiled project and an owned loopback publisher contract.
  await using fixture = await publisherFixture();
  const operator = await fixture.login("operator@quire.local");
  const owner = await fixture.login();
  expect((await fixture.configure(operator, "direct", 0)).status).toBe(200);
  const grant = await fixture.connect(owner);
  const project = await fixture.createCompiledProject(owner);
  const before = fixture.provider.submitRequests;
  const prepared = await prepareSubmission({
    fixture, owner, grant, projectId: project.id, key: crypto.randomUUID(),
  });
  expect(fixture.provider.submitRequests).toBe(before);
  const archive = await fixture.archive(owner, prepared.archiveOperationId);
  expect(new Bun.CryptoHasher("sha256").update(archive).digest("hex")).toBe(prepared.archiveSha256);
  const entries = fixture.readZip(archive);
  const manifestEntry = entries.find(entry => entry.path === "manifest.json");
  const pdf = entries.find(entry => entry.path === "generated/output.pdf");
  if (!manifestEntry || !pdf) throw new TypeError("Expected submission manifest and real compiler PDF");
  const manifest = z.object({
    kind: z.literal("submission"), snapshotId: z.string(),
    source: z.array(z.string()), generated: z.array(z.string()),
  }).parse(JSON.parse(new TextDecoder().decode(manifestEntry.bytes)));
  expect(manifest.source).toEqual(["main.tex", "source.bin"]);
  expect(manifest.generated).toContain("output.pdf");
  expect(entries.find(entry => entry.path === "source/source.bin")?.bytes).toEqual(new Uint8Array([0, 255, 37, 81]));
  expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe("%PDF-");

  // When: the same preparation is explicitly submitted, replayed and queried after destination acceptance.
  const input = {
    session: owner, grantId: grant.id, grantVersion: grant.version, projectId: project.id,
    action: "submit" as const, parameters: { preparationId: prepared.preparationId, confirmation: true },
    key: crypto.randomUUID(),
  };
  const submittedOperation = await fixture.operation(await fixture.action(input));
  const submitted = SubmitResultSchema.parse(submittedOperation.result);
  const replay = await fixture.operation(await fixture.action(input));
  fixture.provider.accept(submitted.submissionId);
  const statusOperation = await fixture.operation(await fixture.action({
    ...input, action: "status", parameters: { preparationId: prepared.preparationId }, key: crypto.randomUUID(),
  }));
  const status = SubmitResultSchema.parse(statusOperation.result);

  // Then: archive digest, durable preparation and both provider receipts describe one lifecycle.
  expect(replay).toEqual(submittedOperation);
  expect(fixture.provider.submitRequests).toBe(before + 1);
  expect(fixture.provider.statusRequests).toBe(1);
  expect(submitted.preparationId).toBe(prepared.preparationId);
  expect(status).toEqual({ ...submitted, providerStatus: "accepted" });
  const expectedReceipt = `receipt-${new Bun.CryptoHasher("sha256")
    .update(`${submitted.submissionId}:${prepared.archiveSha256}`).digest("hex")}`;
  expect(submitted.receipt).toBe(expectedReceipt);
  expect(await fixture.runtime.db.get(`SELECT archive_sha256,remote_submission_id,provider_status,receipt
    FROM publisher_submissions WHERE id=?`, [prepared.preparationId])).toEqual({
    archive_sha256: prepared.archiveSha256, remote_submission_id: submitted.submissionId,
    provider_status: "accepted", receipt: submitted.receipt,
  });
  const correlation = {
    projectId: project.id, snapshotId: manifest.snapshotId, prepared, submitted, status,
    submitOperationId: submittedOperation.id, statusOperationId: statusOperation.id,
    archiveSha256: prepared.archiveSha256,
    pdfSha256: new Bun.CryptoHasher("sha256").update(pdf.bytes).digest("hex"),
    providerOrigin: fixture.provider.origin, requests: fixture.provider.observed, root: fixture.root,
  };
  await fixture.retain("prepared-submission.zip", archive);
  await fixture.retain("prepared-manifest.json", manifestEntry.bytes);
  await fixture.retain("compiled-output.pdf", pdf.bytes);
  await fixture.retain("correlation.json", new TextEncoder().encode(JSON.stringify(correlation, null, 2)));
  console.info("P48_CORRELATED_LIFECYCLE", JSON.stringify(correlation));
}, 240000);
