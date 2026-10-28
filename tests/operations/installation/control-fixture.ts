import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdSchema, InstantSchema } from "@quire/contracts";
import { AcceptedReleaseSchema, BindingSchema, InstallationStateSchema } from "../../../services/operations/installation/model";
import { ControlStore } from "../../../services/operations/installation/control-store";
import { AuthenticatedControlCommand, canonicalJson, controlDigest, requestDigest, signControlCommand } from "../../../services/operations/installation/protocol";
import type { ControlCredential } from "../../../services/operations/installation/protocol";
import type { Id } from "@quire/contracts";
import type { InstallationBinding, ReservedUpdateCommand } from "../../../services/operations/installation/model";
import type { LedgerCommit } from "../../../services/operations/installation/control-store";

export const id = (): Id => IdSchema.parse(crypto.randomUUID());
export const at = InstantSchema.parse("2026-10-27T12:00:00.000Z");
export const later = InstantSchema.parse("2026-10-27T12:01:00.000Z");
export const hash = controlDigest("installation-control-fixture");
export async function controlFixture() {
  const root = await mkdtemp(join(tmpdir(), "quire-installation-control-"));
  const path = join(root, "control.sqlite");
  const epoch = id();
  const actorId = id();
  const release = AcceptedReleaseSchema.parse({
    id: id(), version: "2.0.0", sequence: 2, security: true, notes: "Fixture",
    expiresAt: "2026-10-28T00:00:00.000Z", compatibleSchema: [1],
    packageUrl: "https://updates.invalid/package", packageDigest: hash,
    packageBytes: 10, manifestDigest: hash,
  });
  const prior = BindingSchema.parse({
    release: { target: join(root, "releases/prior"), entrypoint: "bin/quire",
      releaseId: id(), sequence: 1, version: "1.0.0", manifestDigest: hash, packageDigest: hash },
    data: { dialect: "sqlite", generationId: id(), dataRoot: join(root, "data/prior") },
  });
  const candidate: InstallationBinding = {
    release: { ...prior.release, target: join(root, "releases/candidate"),
      releaseId: release.id, sequence: release.sequence, version: release.version },
    data: prior.data,
  };
  let store = ControlStore.provision(path, InstallationStateSchema.parse({
    installationId: "fixture-install", protocolVersion: 1, generation: 0,
    roleInventory: [{ role: "api", unit: "quire-fixture-api.service", activators: [] }],
    roleInventoryDigest: controlDigest(canonicalJson([{ role: "api", unit: "quire-fixture-api.service", activators: [] }])),
    supervisorEpoch: epoch, mode: "open", operationId: null, binding: prior,
    floor: { sequence: 1, version: "1.0.0" },
  }));
  function command(key = "fixture-key"): ReservedUpdateCommand {
    const request = { releaseId: release.id, at, autoSecurity: false };
    return { installationId: "fixture-install", operationId: id(), actorId, key,
      request, requestDigest: requestDigest(request) };
  }
  return {
    root, path, epoch, actorId, prior, candidate, release, command,
    get store() { return store; },
    reopen(nextEpoch = id()) {
      store.close();
      store = ControlStore.open(path, "fixture-install", nextEpoch, later);
      return store;
    },
    inhibit(input: ReservedUpdateCommand) {
      store.accept(input, release, at);
      store.claimDue(at);
      return store.inhibit(input.operationId, at);
    },
    stopped(operationId: Id) {
      store.recordStopped(operationId, {
        observedAt: at, inventoryDigest: store.state().roleInventoryDigest,
        managerEvidenceBytes: '{"scope":"ledger-record-test-only"}',
        executions: store.executions().map(record => record.identity),
      }, at);
    },
    recoveryCommand(operationId: Id) {
      const state = store.state();
      const credential: ControlCredential = {
        id: id(), installationId: state.installationId, channel: "operator",
        secret: crypto.getRandomValues(new Uint8Array(32)),
      };
      return AuthenticatedControlCommand.authenticate(signControlCommand({
        protocolVersion: 1, installationId: state.installationId, credentialId: credential.id,
        requestId: id(), issuedAt: at,
        command: { method: "recover", input: {
          installationId: state.installationId, operationId,
          generation: state.generation, supervisorEpoch: state.supervisorEpoch,
        } },
      }, credential), credential, at);
    },
    health(operationId: Id, binding = candidate): Id {
      const state = store.state();
      const healthId = id();
      store.recordIntent({
        id: healthId, operationId, supervisorEpoch: state.supervisorEpoch,
        generation: state.generation, kind: "health", inputBytes: canonicalJson(binding), createdAt: at,
      });
      store.recordResult(healthId, "succeeded", '{"probe":"persisted-result-only"}', at);
      return healthId;
    },
    commitInput(operationId: Id, healthIntentId: Id): LedgerCommit {
      const state = store.state();
      return {
        operationId, supervisorEpoch: state.supervisorEpoch, generation: state.generation,
        binding: candidate, healthIntentId, outcome: "succeeded", errorCode: null,
        resultBytes: '{ "version": "2.0.0", "ok": true }\n',
        successfulFloor: { sequence: 2, version: "2.0.0" }, at,
      };
    },
    async [Symbol.asyncDispose]() {
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
