import { expect, spyOn, test } from "bun:test";
import { IdSchema } from "@quire/contracts";
import { ReportedUpdateFailure } from "../../../services/operations/updates/model";
import { canonicalJson, controlDigest } from "../../../services/operations/installation/protocol";
import type { ExecutionIdentity } from "../../../services/operations/installation/model";
import { fixture } from "./fixture";
import { rejection } from "./rejection";

for (const proofMode of ["complete", "missing", "different-intent"] as const) {
  test(`prepared health failure requires ${proofMode} ledger evidence for automatic rollback`, async () => {
    // This tests updater/ledger admission, not host process attestation.
    // Actual systemd/cohort evidence belongs to the supervisor integration gate.
    await using f = await fixture();
    f.control.installSupervisorExtensions();
    const original = f.authority.prepare.bind(f.authority);
    const prepare = spyOn(f.authority, "prepare").mockImplementation(async input => {
      if (input.binding.release.version !== "2.0.0") return original(input);
      const state = f.control.state();
      if (state.operationId === null) throw new Error("Installing operation required");
      const intent = f.control.intents(state.operationId).find(entry => entry.kind === "health" && entry.outcome === null);
      if (!intent) throw new Error("Actual pending updater health intent required");
      const execution: ExecutionIdentity = {
        id: IdSchema.parse(crypto.randomUUID()), installationId: state.installationId,
        operationId: state.operationId, supervisorEpoch: state.supervisorEpoch, generation: state.generation,
        role: "contract-fixture-only", purpose: "prepared", unit: "fixture-prepared.service",
        invocationId: crypto.randomUUID(), containerIds: [],
      };
      const resultBytes = canonicalJson({ outcome: "failed", scope: "ledger-contract-fixture-only" });
      f.control.executionIntent(execution, f.clock.now());
      f.control.acknowledgeExecution(execution.id, "started", f.clock.now());
      f.control.acknowledgeExecution(execution.id, "exited", f.clock.now(), resultBytes);
      if (proofMode !== "missing") {
        let healthIntentId = intent.id;
        if (proofMode === "different-intent") {
          healthIntentId = IdSchema.parse(crypto.randomUUID());
          f.control.recordIntent({
            id: healthIntentId, operationId: state.operationId, supervisorEpoch: state.supervisorEpoch,
            generation: state.generation, kind: "health", inputBytes: intent.inputBytes, createdAt: f.clock.now(),
          });
        }
        const stopEvidenceBytes = canonicalJson({ scope: "ledger-contract-fixture-only", notHostAttestation: true });
        f.control.recordCompletedHealthFailure({
          failedExecutionId: execution.id, operationId: state.operationId, supervisorEpoch: state.supervisorEpoch,
          generation: state.generation, healthIntentId, bindingDigest: controlDigest(intent.inputBytes), resultBytes,
          drainedExecutions: [execution], stopEvidenceBytes, stopEvidenceDigest: controlDigest(stopEvidenceBytes),
        });
      }
      throw new ReportedUpdateFailure("HEALTHCHECK_FAILED", { execution, resultBytes, migrationDigests: [] });
    });
    try {
      const queued = await f.schedule();
      if (proofMode === "complete") {
        await f.service.tick();
        const operation = await f.service.store.operation(queued.id);
        expect(operation.status).toBe("failed");
        expect(operation.result?.["rolledBack"]).toBe(true);
        expect(f.control.state().mode).toBe("open");
        expect(f.control.state().binding.release.version).toBe("1.0.0");
        expect(f.migrated()).toBeNull();
        expect(f.document()).toEqual({ body: "retained source" });
      } else {
        expect(await rejection(f.service.tick())).toMatchObject({ code: "UPDATE_HELPER_RESULT_UNPROVEN" });
        expect(f.control.state().mode).toBe("recovery_required");
        expect((await f.service.store.operation(queued.id)).result?.["rolledBack"]).not.toBe(true);
      }
    } finally {
      prepare.mockRestore();
    }
  });
}
