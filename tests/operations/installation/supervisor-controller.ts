import { readFile } from "node:fs/promises";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { SystemdInstallationAuthority } from "../../../services/operations/installation/systemd-authority";
import { InstallationStorageHost } from "../../../services/operations/installation/storage";
import { connectControl, handleControl, startControllerServer } from "../../../services/operations/installation/controller-server";
import { AcceptedReleaseSchema, BindingSchema, ReservedUpdateCommandSchema, ControlError } from "../../../services/operations/installation/model";
import type { PreparedInstallation, StoppedInstallation, VerifiedInstallationBackup } from "../../../services/operations/installation/model";
import { canonicalJson } from "../../../services/operations/installation/protocol";
import { InstantSchema } from "@quire/contracts";
import { join } from "node:path";

const path = z.string().parse(process.argv[2]);
const harness = z.string().parse(process.argv[3]);
const value: unknown = JSON.parse(await readFile(path, "utf8"));
const setup = z.object({ config: z.unknown(), policy: z.unknown(),
  operator: z.object({ id: IdSchema, secret: z.string() }) }).parse(value);
const authority = await SystemdInstallationAuthority.open(setup.config);
const storage = new InstallationStorageHost(authority, setup.policy);
const rpc = await startControllerServer({
  path: join(authority.config.socketRoot, "control.sock"), authority,
  credentials: [{ role: null, credential: { id: setup.operator.id, secret: Buffer.from(setup.operator.secret, "hex"),
    channel: "operator", installationId: authority.config.installationId } }],
  service: {
    async releases() { throw new ControlError("UPDATES_UNCONFIGURED"); },
    async create() { throw new ControlError("UPDATES_UNCONFIGURED"); },
    async get(operationId) { return authority.store.get(operationId); },
    async list(query) { return authority.store.list(query); },
    async recover(authenticated) {
      const state = authority.store.beginRecovery(authenticated, InstantSchema.parse(new Date().toISOString()));
      if (state.operationId === null) throw new ControlError("CONTROL_NOT_OWNER");
      return authority.recover({ installationId: state.installationId, operationId: state.operationId,
        generation: state.generation, supervisorEpoch: state.supervisorEpoch });
    },
  },
});
const channel = await connectControl(harness);
let stopped: StoppedInstallation | undefined;
let prepared: PreparedInstallation | undefined;
let backup: VerifiedInstallationBackup | undefined;
handleControl(channel, async (method, input) => {
  switch (method) {
    case "state": return authority.status();
    case "capabilities": return authority.capabilities();
    case "start": await authority.startCommittedRoles(); return authority.store.executions();
    case "stop": {
      const parsed = z.object({ command: ReservedUpdateCommandSchema, release: AcceptedReleaseSchema }).parse(input);
      authority.store.accept(parsed.command, parsed.release, InstantSchema.parse(new Date().toISOString()));
      authority.store.claimDue(InstantSchema.parse(new Date().toISOString()));
      stopped = await authority.stopForUpdate(parsed.command.operationId);
      return authority.status();
    }
    case "backup": {
      if (!stopped) throw new ControlError("TEST_STOPPED_REQUIRED");
      backup = await storage.backup(stopped);
      return backup;
    }
    case "restore": {
      if (!stopped || !backup) throw new ControlError("TEST_BACKUP_REQUIRED");
      return storage.restore({ stopped, backup, prior: authority.store.state().binding, retained: [authority.store.state().binding] });
    }
    case "preflight":
    case "migrate": {
      if (!stopped || !backup) throw new ControlError("TEST_BACKUP_REQUIRED");
      const candidate = BindingSchema.parse(input);
      const { originalMigrationLedger, ...archive } = backup;
      authority.store.recovery(stopped.operationId, { candidate, backup: archive, originalMigrationLedger, restoreResult: null },
        InstantSchema.parse(new Date().toISOString()));
      return method === "preflight" ? storage.preflight({ stopped, backup, candidate }) :
        storage.migrate({ stopped, candidate, originalMigrationLedger });
    }
    case "prepare": {
      if (!stopped) throw new ControlError("TEST_STOPPED_REQUIRED");
      const requested = z.object({ binding: BindingSchema.optional() }).parse(input);
      prepared = await authority.prepare({ stopped, binding: requested.binding ?? authority.store.state().binding, expectedMigrationDigests: [] });
      return { digest: prepared.healthEvidenceDigest, executions: authority.store.executions() };
    }
    case "commit": {
      if (!prepared) throw new ControlError("TEST_PREPARED_REQUIRED");
      const receipt = authority.store.receipt(prepared.stopped.operationId);
      if (!receipt) throw new ControlError("TEST_RECEIPT_REQUIRED");
      const success = z.object({ success: z.boolean().default(false) }).parse(input).success;
      const result = { stoppedProof: true };
      return authority.commit({ prepared, operation: OperationSchema.parse({ ...receipt.operation, status: success ? "succeeded" : "failed",
        errorCode: success ? null : "TEST_UNCHANGED", result, progress: 1 }), resultBytes: canonicalJson(result),
      successfulFloor: success ? { sequence: receipt.release.sequence, version: receipt.release.version } : null });
    }
    case "executions": return authority.store.executions();
    default: throw new ControlError("TEST_METHOD_DENIED");
  }
});
await channel.request("ready", { pid: process.pid });
await channel.closed;
await rpc.close();
await authority.close();
