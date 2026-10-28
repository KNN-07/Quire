import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { z } from "zod";
import { ControlReceiptSchema, InstallationStateSchema } from "../../../../services/operations/installation/model";
import { CompletedHealthFailureSchema } from "../../../../services/operations/installation/execution-ledger";
import { canonicalJson, controlDigest } from "../../../../services/operations/installation/protocol";
import { executionFixture } from "./fixture";

test("actual reported prepared health failure drains both roles and automatically restores a fresh native generation", async () => {
  await using fixture = await executionFixture();
  const controller = await fixture.start();
  const receipt = ControlReceiptSchema.parse(await controller.request("update", fixture.update));
  expect(receipt.operation.status).toBe("failed");
  expect(receipt.operation.errorCode).toBe("ENOENT");
  expect(receipt.operation.result).toMatchObject({ rolledBack: true });
  const state = InstallationStateSchema.parse(await controller.request("state", {}));
  expect(state.mode).toBe("open");
  expect(state.binding.data.generationId).not.toBe(fixture.prior.data.generationId);
  expect(state.floor).toEqual({ sequence: 1, version: "1.0.0" });
  expect(state.binding.release).toEqual(fixture.prior.release);
  const proofs = z.array(CompletedHealthFailureSchema).parse(await controller.request("health-proofs", {}));
  expect(proofs).toHaveLength(1);
  const proof = proofs[0];
  if (!proof || !receipt.recovery?.candidate) throw new Error("Actual completed-health evidence required");
  expect(proof.bindingDigest).toBe(controlDigest(canonicalJson(receipt.recovery.candidate)));
  expect(proof.drainedExecutions.length).toBeGreaterThanOrEqual(1);
  expect(proof.stopEvidenceDigest).toBe(controlDigest(proof.stopEvidenceBytes));
  const control = new Database(join(fixture.roots.control, "control.sqlite"), { readonly: true });
  try {
    const intent = z.object({ record_json: z.string() }).parse(
      control.query("SELECT record_json FROM execution_intents WHERE id=?").get(proof.healthIntentId));
    expect(JSON.parse(intent.record_json)).toMatchObject({ kind: "health", outcome: "failed", resultBytes: proof.resultBytes });
  } finally { control.close(); }
  if (state.binding.data.dialect !== "sqlite") throw new Error("Native target required");
  const target = new Database(join(state.binding.data.dataRoot, "quire.sqlite"), { readonly: true });
  try { expect(target.query("SELECT name FROM sqlite_master WHERE name='p9_upgrade_probe'").get()).toBeNull(); }
  finally { target.close(); }
}, 240000);
