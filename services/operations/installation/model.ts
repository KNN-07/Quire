import { z } from "zod";
import { DigestSchema, IdSchema, InstantSchema, OperationSchema } from "@quire/contracts";
import type { Digest, Id, Operation, Release } from "@quire/contracts";

export class ControlError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "ControlError";
  }
}

export const InstallationIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(128);
const path = z.string().startsWith("/").refine(value => !value.includes("\0"));
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const generationCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const FloorSchema = z.strictObject({ sequence: generationCount, version }).readonly();
export const DataBindingSchema = z.discriminatedUnion("dialect", [
  z.strictObject({ dialect: z.literal("sqlite"), generationId: IdSchema, dataRoot: path }),
  z.strictObject({
    dialect: z.literal("postgres"), generationId: IdSchema,
    database: z.strictObject({ identity: z.string().min(1), connectionSecretRef: path }),
    blobs: z.strictObject({
      endpoint: z.url(), region: z.string().min(1), bucket: z.string().min(1), credentialsSecretRef: path,
    }),
    repository: z.strictObject({ volume: path, endpoint: z.url(), credentialsSecretRef: path }),
    redis: z.strictObject({ namespace: z.string().min(1), connectionSecretRef: path }),
    applicationSecretRef: path,
  }),
]).readonly();
export type DataBinding = z.infer<typeof DataBindingSchema>;
export const ReleaseTargetSchema = z.strictObject({
  target: path, entrypoint: z.string().min(1),
  releaseId: IdSchema, version, sequence: generationCount,
  manifestDigest: DigestSchema, packageDigest: DigestSchema,
}).readonly();
export type ReleaseTarget = z.infer<typeof ReleaseTargetSchema>;
export const BindingSchema = z.strictObject({ release: ReleaseTargetSchema, data: DataBindingSchema }).readonly();
export type InstallationBinding = z.infer<typeof BindingSchema>;
export const RoleInventorySchema = z.strictObject({
  role: z.string().min(1), unit: z.string().min(1),
  activators: z.array(z.string().min(1)).readonly(),
}).readonly();
export const InstallationStateSchema = z.strictObject({
  installationId: InstallationIdSchema, protocolVersion: z.literal(1),
  roleInventory: z.array(RoleInventorySchema).min(1).readonly(), roleInventoryDigest: DigestSchema,
  generation: generationCount, supervisorEpoch: IdSchema,
  mode: z.enum(["open", "installing", "recovery_required"]),
  operationId: IdSchema.nullable(), binding: BindingSchema, floor: FloorSchema,
}).readonly();
export type InstallationState = z.infer<typeof InstallationStateSchema>;

export const ReservedUpdateCommandSchema = z.strictObject({
  installationId: InstallationIdSchema, operationId: IdSchema, actorId: IdSchema,
  key: z.string().min(1).max(512), requestDigest: DigestSchema,
  request: z.strictObject({ releaseId: IdSchema, at: InstantSchema, autoSecurity: z.boolean() }).readonly(),
}).readonly();
export type ReservedUpdateCommand = z.infer<typeof ReservedUpdateCommandSchema>;
export const AcceptedReleaseSchema = z.strictObject({
  id: IdSchema, version, sequence: generationCount, security: z.boolean(), notes: z.string().max(100_000),
  expiresAt: InstantSchema, compatibleSchema: z.array(generationCount).min(1).readonly(),
  packageUrl: z.url(), packageDigest: DigestSchema, packageBytes: z.number().int().positive(),
  manifestDigest: DigestSchema,
}).readonly();
export type AcceptedRelease = z.infer<typeof AcceptedReleaseSchema>;
export const RecoveryRecordSchema = z.strictObject({
  prior: BindingSchema, candidate: BindingSchema.nullable(),
  backup: z.strictObject({
    id: IdSchema, digest: DigestSchema, path, verifiedAt: InstantSchema,
  }).readonly().nullable(),
  originalMigrationLedger: z.string().nullable(),
  migrationIntent: z.string().nullable(), activationIntent: z.string().nullable(),
  restoreResult: z.string().nullable(), lastCompletedStep: z.string().nullable(),
}).readonly();
export type RecoveryRecord = z.infer<typeof RecoveryRecordSchema>;
export const PhaseSchema = z.enum([
  "queued", "validating", "staged", "stopping", "stopped", "backed_up", "preflight",
  "migrating", "switched", "prepared", "succeeded", "failed", "recovery_required",
]);
export const ControlReceiptSchema = z.strictObject({
  command: ReservedUpdateCommandSchema, release: AcceptedReleaseSchema,
  operation: OperationSchema, phase: PhaseSchema, recovery: RecoveryRecordSchema.nullable(),
  createdAt: InstantSchema, updatedAt: InstantSchema,
  resultBytes: z.string().nullable(),
}).readonly();
export type ControlReceipt = z.infer<typeof ControlReceiptSchema>;
export interface UpdateOperationRow {
  readonly actorId: Id;
  readonly operation: Operation;
  readonly createdAt: z.infer<typeof InstantSchema>;
  readonly updatedAt: z.infer<typeof InstantSchema>;
}
export const UpdateOperationQuerySchema = z.strictObject({
  actorId: IdSchema.optional(), kind: z.string().optional(),
  status: OperationSchema.unwrap().shape.status.optional(), cursor: IdSchema.optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(100),
}).readonly();
export type UpdateOperationQuery = z.infer<typeof UpdateOperationQuerySchema>;
export interface UpdateClient {
  releases(): Promise<readonly Release[]>;
  create(request: ReservedUpdateCommand): Promise<Operation>;
  get(id: Id): Promise<UpdateOperationRow | null>;
  list(query: UpdateOperationQuery): Promise<readonly UpdateOperationRow[]>;
}

export const ExecutionIdentitySchema = z.strictObject({
  id: IdSchema, installationId: InstallationIdSchema, operationId: IdSchema.nullable(),
  supervisorEpoch: IdSchema, generation: generationCount, role: z.string().min(1),
  purpose: z.enum(["ordinary", "backup", "preflight", "migration", "restore", "prepared", "health"]),
  unit: z.string().min(1), invocationId: z.string().min(1),
  containerIds: z.array(z.string().min(1)).readonly(),
}).readonly();
export type ExecutionIdentity = z.infer<typeof ExecutionIdentitySchema>;
export const ExecutionRecordSchema = z.strictObject({
  identity: ExecutionIdentitySchema, intentAt: InstantSchema,
  startedAt: InstantSchema.nullable(), exitedAt: InstantSchema.nullable(),
  resultBytes: z.string().nullable(),
}).readonly();
export type ExecutionRecord = z.infer<typeof ExecutionRecordSchema>;

// Only the real host driver can implement these opaque authorities. The ledger
// records evidence; it cannot infer that an invocation has actually stopped.
export abstract class StoppedInstallation {
  readonly #installationId: string;
  protected constructor(
    installationId: string,
    readonly operationId: Id,
    readonly supervisorEpoch: Id,
    readonly generation: number,
    readonly invocations: readonly ExecutionIdentity[],
  ) { this.#installationId = installationId; }
  get installationId(): string { return this.#installationId; }
}
export abstract class PreparedInstallation {
  readonly #stopped: StoppedInstallation;
  protected constructor(
    stopped: StoppedInstallation,
    readonly binding: InstallationBinding,
    readonly healthEvidenceDigest: Digest,
  ) { this.#stopped = stopped; }
  get stopped(): StoppedInstallation { return this.#stopped; }
}
export interface InstallationCapabilities {
  readonly driver: "systemd-local-v1";
  readonly installationId: string;
  readonly roleInventoryDigest: Digest;
  readonly dialect: DataBinding["dialect"];
  readonly freshRestore: { readonly inventoryDigest: Digest; readonly verified: true };
}
export interface PrepareInstallation {
  readonly stopped: StoppedInstallation;
  readonly binding: InstallationBinding;
  readonly expectedMigrationDigests: readonly Digest[];
}
export interface InstallationCommit {
  readonly prepared: PreparedInstallation;
  readonly operation: Operation;
  readonly resultBytes: string;
  readonly successfulFloor: z.infer<typeof FloorSchema> | null;
}
export const RecoveryRequestSchema = z.strictObject({
  installationId: InstallationIdSchema, operationId: IdSchema,
  generation: generationCount, supervisorEpoch: IdSchema,
}).readonly();
export type RecoveryRequest = z.infer<typeof RecoveryRequestSchema>;
export interface InstallationAuthority {
  capabilities(): Promise<InstallationCapabilities>;
  stopForUpdate(operationId: Id): Promise<StoppedInstallation>;
  withStopped<T>(stopped: StoppedInstallation, work: () => Promise<T>): Promise<T>;
  prepare(input: PrepareInstallation): Promise<PreparedInstallation>;
  commit(input: InstallationCommit): Promise<Operation>;
  recover(input: RecoveryRequest): Promise<Operation>;
}
export type VerifiedInstallationBackup = NonNullable<RecoveryRecord["backup"]> & {
  readonly originalMigrationLedger: string;
};
export interface MigrationEvidence {
  readonly execution: ExecutionIdentity;
  readonly migrationDigests: readonly Digest[];
  readonly resultBytes: string;
}
export interface InstallationPreflight {
  readonly stopped: StoppedInstallation;
  readonly backup: VerifiedInstallationBackup;
  readonly candidate: InstallationBinding;
}
export interface InstallationMigration {
  readonly stopped: StoppedInstallation;
  readonly candidate: InstallationBinding;
  readonly originalMigrationLedger: string;
}
export interface InstallationRestore {
  readonly stopped: StoppedInstallation;
  readonly backup: VerifiedInstallationBackup;
  readonly prior: InstallationBinding;
  readonly retained: readonly InstallationBinding[];
}
export interface RestoredBinding {
  readonly binding: InstallationBinding;
  readonly evidence: MigrationEvidence;
}
export interface InstallationStorage {
  backup(stopped: StoppedInstallation): Promise<VerifiedInstallationBackup>;
  preflight(input: InstallationPreflight): Promise<MigrationEvidence>;
  migrate(input: InstallationMigration): Promise<MigrationEvidence>;
  restore(input: InstallationRestore): Promise<RestoredBinding>;
}
