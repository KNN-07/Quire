import { afterAll, beforeAll, expect, test } from "bun:test";
import { z } from "zod";
import type { AdapterGrant } from "@quire/contracts";
import {
  publisherFixture,
  type PublisherFixture,
  type Session,
} from "./harness";
import {
  SubmitResultSchema,
  prepareSubmission,
  type PrepareResultSchema,
} from "./assertions";
import { registerNegativePublisherScenarios } from "./negative-scenarios";
let fixture: PublisherFixture;
let owner: Session;
let outsider: Session;
let operator: Session;
let projectId: string;
let ownerGrant: AdapterGrant;
let outsiderGrant: AdapterGrant;
let preparedForSubmit: z.infer<typeof PrepareResultSchema>;
let preparedForStatus: z.infer<typeof PrepareResultSchema>;
let preparedForError: z.infer<typeof PrepareResultSchema>;
let submittedForStatus: z.infer<typeof SubmitResultSchema>;

async function prepare(key: string) {
  return prepareSubmission({
    fixture,
    owner,
    grant: ownerGrant,
    projectId,
    key,
  });
}

beforeAll(async () => {
  fixture = await publisherFixture();
  operator = await fixture.login("operator@quire.local");
  owner = await fixture.login();
  outsider = await fixture.login("outsider@quire.local");
  expect((await fixture.configure(operator, "direct", 0)).status).toBe(200);
  ownerGrant = await fixture.connect(owner);
  outsiderGrant = await fixture.connect(outsider);
  projectId = (await fixture.createCompiledProject(owner)).id;
  preparedForSubmit = await prepare("prepare-for-submit");
  preparedForStatus = await prepare("prepare-for-status");
  preparedForError = await prepare("prepare-for-error");
  const submitted = await fixture.operation(await fixture.action({
    session: owner,
    grantId: ownerGrant.id,
    grantVersion: ownerGrant.version,
    projectId,
    action: "submit",
    parameters: {
      preparationId: preparedForStatus.preparationId,
      confirmation: true,
    },
    key: "setup-status-submission",
  }));
  submittedForStatus = SubmitResultSchema.parse(submitted.result);
}, 240_000);

afterAll(async () => {
  await fixture[Symbol.asyncDispose]();
});

test("prepares the real interchange archive without publisher traffic", async () => {
  // Given
  const before = fixture.provider.submitRequests;
  // When
  const prepared = await prepare("observed-zero-traffic-prepare");
  const archive = await fixture.archive(owner, prepared.archiveOperationId);
  // Then
  expect(fixture.provider.submitRequests).toBe(before);
  expect(prepared.support).toEqual({
    prepare: true,
    manual: false,
    direct: true,
  });
  const entries = fixture.readZip(archive);
  const manifest = entries.find((entry) => entry.path === "manifest.json");
  if (!manifest) throw new TypeError("Prepared publisher archive manifest missing");
  const parsed = z.object({
    kind: z.literal("submission"),
    source: z.array(z.string()),
    generated: z.array(z.string()),
  }).parse(JSON.parse(new TextDecoder().decode(manifest.bytes)));
  expect(parsed.source).toEqual(["main.tex", "source.bin"]);
  expect(parsed.generated.some((path) => path.endsWith(".pdf"))).toBe(true);
  expect(entries.find((entry) => entry.path === "source/source.bin")?.bytes)
    .toEqual(new Uint8Array([0, 255, 37, 81]));
  expect(
    new Bun.CryptoHasher("sha256").update(archive).digest("hex"),
  ).toBe(prepared.archiveSha256);
  await fixture.retain("prepared-submission.zip", archive);
  await fixture.retain("prepared-manifest.json", manifest.bytes);
}, 30_000);

test("submits once with explicit confirmation and replays the durable receipt", async () => {
  // Given
  const key = "authorized-direct-submit";
  const before = fixture.provider.submitRequests;
  // When
  const first = await fixture.operation(await fixture.action({
    session: owner,
    grantId: ownerGrant.id,
    grantVersion: ownerGrant.version,
    projectId,
    action: "submit",
    parameters: {
      preparationId: preparedForSubmit.preparationId,
      confirmation: true,
    },
    key,
  }));
  const replay = await fixture.operation(await fixture.action({
    session: owner,
    grantId: ownerGrant.id,
    grantVersion: ownerGrant.version,
    projectId,
    action: "submit",
    parameters: {
      preparationId: preparedForSubmit.preparationId,
      confirmation: true,
    },
    key,
  }));
  // Then
  const result = SubmitResultSchema.parse(first.result);
  expect(result.providerStatus).toBe("received");
  expect(result.receipt).toStartWith("receipt-");
  expect(replay).toEqual(first);
  expect(fixture.provider.submitRequests).toBe(before + 1);
  expect(await fixture.runtime.db.get<{
    state: string;
    remote_submission_id: string;
    provider_status: string;
    receipt: string;
  }>(
    "SELECT state,remote_submission_id,provider_status,receipt FROM publisher_submissions WHERE id=?",
    [preparedForSubmit.preparationId],
  )).toEqual({
    state: "submitted",
    remote_submission_id: result.submissionId,
    provider_status: "received",
    receipt: result.receipt,
  });
  await fixture.retain(
    "submission-receipt.json",
    new TextEncoder().encode(JSON.stringify(result, null, 2)),
  );
});

test("refreshes status from the configured destination and persists its receipt", async () => {
  // Given
  fixture.provider.accept(submittedForStatus.submissionId);
  const before = fixture.provider.statusRequests;
  // When
  const operation = await fixture.operation(await fixture.action({
    session: owner,
    grantId: ownerGrant.id,
    grantVersion: ownerGrant.version,
    projectId,
    action: "status",
    parameters: {
      preparationId: preparedForStatus.preparationId,
    },
    key: "accepted-status",
  }));
  // Then
  const result = SubmitResultSchema.parse(operation.result);
  expect(result.providerStatus).toBe("accepted");
  expect(fixture.provider.statusRequests).toBe(before + 1);
  expect(await fixture.runtime.db.get<{
    provider_status: string;
    receipt: string;
  }>(
    "SELECT provider_status,receipt FROM publisher_submissions WHERE id=?",
    [preparedForStatus.preparationId],
  )).toEqual({
    provider_status: "accepted",
    receipt: submittedForStatus.receipt,
  });
  await fixture.retain(
    "status-receipt.json",
    new TextEncoder().encode(JSON.stringify(result, null, 2)),
  );
});

registerNegativePublisherScenarios(() => ({
  fixture,
  owner,
  outsider,
  operator,
  projectId,
  ownerGrant,
  outsiderGrant,
  preparedForError,
  prepare,
}));
