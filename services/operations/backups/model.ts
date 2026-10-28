import { z } from "zod";
import { DigestSchema, GitOidSchema, IdSchema, InstantSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Runtime } from "@quire/runtime";
import type { KeyObject } from "node:crypto";

export class BackupError extends ServiceError {
  constructor(code: string, message: string) { super(code, 409, message); }
}
export const identifierSchema = z.string().regex(/^[a-z_][a-z_0-9]*$/);
export const identifier = (value: string): string => `"${identifierSchema.parse(value)}"`;
export const cellSchema = z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.strictObject({ binary: z.base64() }).readonly(),
  z.strictObject({ integer: z.string().regex(/^-?\d+$/) }).readonly(),
]);
export type Cell = z.infer<typeof cellSchema>;
export const tableSchema = z.strictObject({
  name: identifierSchema, dependencies: z.array(identifierSchema).readonly(),
  rows: z.array(z.record(identifierSchema, cellSchema).readonly()).readonly(),
}).readonly();
export const databaseSchema = z.strictObject({
  dialect: z.enum(["sqlite", "postgres"]), tables: z.array(tableSchema).readonly(),
}).readonly();
export type DatabaseImage = z.infer<typeof databaseSchema>;
export const repositorySchema = z.strictObject({
  projectId: IdSchema, objects: z.number().int().nonnegative(),
  refs: z.array(z.strictObject({ ref: z.string().regex(/^refs\/[^\s\0]+$/), oid: GitOidSchema }).readonly()).readonly(),
}).readonly();
export type RepositoryImage = z.infer<typeof repositorySchema>;
export const fileSchema = z.strictObject({
  path: z.string().regex(/^(database\.json|configuration\.json|secret\.key|blobs\/[0-9a-f]{64}|repositories\/[0-9a-f-]{36}\.pack)$/),
  bytes: z.number().int().nonnegative(), sha256: DigestSchema,
}).readonly();
export const manifestSchema = z.strictObject({
  format: z.literal("quire-full-recovery-v1"), id: IdSchema, createdAt: InstantSchema,
  dialect: z.enum(["sqlite", "postgres"]), authority: DigestSchema, signer: DigestSchema,
  files: z.array(fileSchema).readonly(), repositories: z.array(repositorySchema).readonly(),
  tables: z.array(z.strictObject({ name: identifierSchema, rows: z.number().int().nonnegative() }).readonly()).readonly(),
}).readonly();
export type Manifest = z.infer<typeof manifestSchema>;
export type BackupContext = Pick<ModuleContext, "db" | "uow" | "blobs" | "repositories" | "branches" | "secretKey" | "clock" | "config">;
export type BackupHost = {
  /** Stop admission and drain EVERY writer, including worker roles, until work settles. */
  readonly exclusive: <T>(work: () => Promise<T>) => Promise<T>;
  /** Operator-selected isolated storage; must never resolve a live database/bucket/volume. */
  readonly openFresh: (target: string, key: Uint8Array) => Promise<Runtime>;
  readonly configuration: Readonly<Record<string, string>>;
  /** Independent Ed25519 private key, never included in the recovery archive. */
  readonly signingKey: KeyObject;
  readonly backupRoot: string;
  readonly restoreRoot: string;
};
const hosts = new WeakMap<object, BackupHost>();
export function configureBackups(context: Pick<BackupContext, "db">, host: BackupHost): void {
  hosts.set(context.db, host);
}
export function backupHost(context: Pick<BackupContext, "db">): BackupHost {
  const host = hosts.get(context.db);
  if (!host) throw new BackupError("BACKUP_QUIESCENCE_REQUIRED", "The application must install its all-writer maintenance host");
  return host;
}
export function digest(bytes: Uint8Array | string) {
  return DigestSchema.parse(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
}
