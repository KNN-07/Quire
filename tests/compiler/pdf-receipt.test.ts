import { expect, test } from "bun:test";
import { pdfValidationReceipt, validPdfReceipt } from "../../services/compiler/pdf-receipt";
import { fixtureIds as ids } from "../fixtures/foundation";

test("PDF validation receipt binds every artifact and lease identity field", () => {
  // Given: the trusted worker has validated one artifact under one lease.
  const identity = { jobId: ids.project, attempt: 1, fencingToken: 4,
    environmentId: ids.environment, imageDigest: `sha256:${"a".repeat(64)}`,
    name: "output.pdf", digest: "b".repeat(64) };
  const receipt = pdfValidationReceipt("worker-secret", identity);
  // When: validation is checked for that exact identity and for altered inputs.
  expect(validPdfReceipt("worker-secret", identity, receipt)).toBe(true);
  for (const changed of [
    { ...identity, jobId: ids.operator }, { ...identity, attempt: 2 },
    { ...identity, fencingToken: 5 }, { ...identity, environmentId: ids.operator },
    { ...identity, imageDigest: `sha256:${"c".repeat(64)}` },
    { ...identity, name: "other.pdf" }, { ...identity, digest: "d".repeat(64) },
  ]) {
    // Then: no receipt can be moved to another artifact, image or worker attempt.
    expect(validPdfReceipt("worker-secret", changed, receipt)).toBe(false);
  }
  expect(validPdfReceipt("different-secret", identity, receipt)).toBe(false);
  expect(validPdfReceipt("worker-secret", identity, null)).toBe(false);
  expect(validPdfReceipt("worker-secret", identity, "invalid")).toBe(false);
});
