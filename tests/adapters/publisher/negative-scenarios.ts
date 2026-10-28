import { expect, test } from "bun:test";
import type { AdapterGrant } from "@quire/contracts";
import {
  ErrorEnvelope,
  SubmitResultSchema,
} from "./assertions";
import type { PrepareResult } from "./assertions";
import type {
  PublisherFixture,
  Session,
} from "./harness";

export type PublisherScenarioState = {
  readonly fixture: PublisherFixture;
  readonly owner: Session;
  readonly outsider: Session;
  readonly operator: Session;
  readonly projectId: string;
  readonly ownerGrant: AdapterGrant;
  readonly outsiderGrant: AdapterGrant;
  readonly preparedForError: PrepareResult;
  readonly prepare: (key: string) => Promise<PrepareResult>;
};

export function registerNegativePublisherScenarios(
  state: () => PublisherScenarioState,
): void {
  test("denies a grant owner without current project access before provider traffic", async () => {
    // Given
    const current = state();
    const before = current.fixture.provider.submitRequests;
    // When
    const response = await current.fixture.action({
      session: current.outsider,
      grantId: current.outsiderGrant.id,
      grantVersion: current.outsiderGrant.version,
      projectId: current.projectId,
      action: "prepare",
      parameters: {},
      key: "outsider-prepare",
    });
    // Then
    expect(response.status).toBe(404);
    expect(current.fixture.provider.submitRequests).toBe(before);
  });

  test("rejects actions after the destination grant is revoked", async () => {
    // Given
    const current = state();
    const response = await current.fixture.request(
      `/api/connections/${current.outsiderGrant.id}`,
      {
        method: "DELETE",
        headers: current.outsider.headers,
        body: JSON.stringify({ expectedVersion: current.outsiderGrant.version }),
      },
    );
    expect(response.status).toBe(200);
    // When
    const denied = await current.fixture.action({
      session: current.outsider,
      grantId: current.outsiderGrant.id,
      grantVersion: current.outsiderGrant.version,
      projectId: current.projectId,
      action: "prepare",
      parameters: {},
      key: "revoked-prepare",
    });
    // Then
    expect(denied.status).toBe(503);
    expect(ErrorEnvelope.parse(await denied.json()).error.code).toBe("GRANT_UNAVAILABLE");
  });

  test("records provider failure without manufacturing a submission receipt", async () => {
    // Given
    const current = state();
    current.fixture.provider.failSubmission();
    // When
    const response = await current.fixture.action({
      session: current.owner,
      grantId: current.ownerGrant.id,
      grantVersion: current.ownerGrant.version,
      projectId: current.projectId,
      action: "submit",
      parameters: {
        preparationId: current.preparedForError.preparationId,
        confirmation: true,
      },
      key: "provider-error-submit",
    });
    // Then
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe("PUBLISHER_HTTP_ERROR");
    expect(await current.fixture.runtime.db.get<{
      state: string;
      remote_submission_id: string | null;
      receipt: string | null;
    }>(
      "SELECT state,remote_submission_id,receipt FROM publisher_submissions WHERE id=?",
      [current.preparedForError.preparationId],
    )).toEqual({
      state: "prepared",
      remote_submission_id: null,
      receipt: null,
    });
  });

  test("records a manual provider receipt without sending the archive", async () => {
    // Given
    const current = state();
    expect((await current.fixture.configure(current.operator, "manual", 1)).status).toBe(200);
    const prepared = await current.prepare("manual-prepare");
    const before = current.fixture.provider.submitRequests;
    // When
    const operation = await current.fixture.operation(await current.fixture.action({
      session: current.owner,
      grantId: current.ownerGrant.id,
      grantVersion: current.ownerGrant.version,
      projectId: current.projectId,
      action: "submit",
      parameters: {
        preparationId: prepared.preparationId,
        confirmation: true,
        manualSubmissionId: "journal-2026-1042",
        manualReceipt: "publisher-confirmation-1042",
      },
      key: "manual-receipt-submit",
    }));
    // Then
    const result = SubmitResultSchema.parse(operation.result);
    expect(prepared.support).toEqual({
      prepare: true,
      manual: true,
      direct: false,
    });
    expect(result).toEqual({
      preparationId: prepared.preparationId,
      submissionId: "journal-2026-1042",
      providerStatus: "submitted-manually",
      receipt: "publisher-confirmation-1042",
      destinationMode: "manual",
      state: "submitted",
    });
    expect(current.fixture.provider.submitRequests).toBe(before);
  });
}
