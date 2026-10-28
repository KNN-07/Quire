import { z } from "zod";
import { routesFor, none, noBody, list, version, key } from "./route-builders";
import { IdSchema as id, CountSchema, InstantSchema, OkSchema as ok, pageSchema, CapabilitySchema, JobStatusSchema } from "./primitives";
import { IdParamsSchema as ids, BytesSchema } from "./endpoint";
import { UserSchema, AdminUserSummarySchema, AuditEntrySchema, PolicySchema } from "./accounts";
import { OperationSchema, OperationSummarySchema, WorkerSchema, EnvironmentSchema, ProviderConfigSchema, BackupSchema, ReleaseSchema } from "./work";
import { ProjectSchema } from "./projects";

const r = routesFor("O");
const a = routesFor("A");
const k = routesFor("K");
const existing = z.strictObject(version);
const provider = z.strictObject({ kind: z.string() });
const user = z.strictObject({ u: id });
const usersQuery = list.extend({
  q: z.string().optional(), role: z.enum(["all", "operator", "member", "guest"]).default("all"),
  state: z.enum(["all", "active", "suspended", "deleted"]).default("active"),
});
export const operationEndpoints = {
  operationsList: r("GET", "/api/operations", { params: none, query: list.extend({ kind: z.string().optional(), status: JobStatusSchema.optional() }), body: noBody, output: pageSchema(OperationSummarySchema) }),
  operationGet: r("GET", "/api/operations/:id", { params: ids, query: none, body: noBody, output: OperationSchema }),
  adminOverview: r("GET", "/api/admin/overview", { params: none, query: none, body: noBody, output: z.strictObject({ users: CountSchema, projects: CountSchema, storageBytes: CountSchema, queuedJobs: CountSchema, runningJobs: CountSchema, capabilities: z.record(z.string(), CapabilitySchema), topology: z.array(z.strictObject({ role: z.string(), backend: z.string(), state: z.string() })) }) }),
  adminUserGet: a("GET", "/api/admin/users/:u", { params: user, query: none, body: noBody, output: UserSchema }),
  adminUsersList: a("GET", "/api/admin/users", { params: none, query: usersQuery, body: noBody, output: pageSchema(AdminUserSummarySchema) }),
  adminUsersCsv: a("GET", "/api/admin/users.csv", { params: none, query: usersQuery.omit({ cursor: true, limit: true }), body: noBody, output: BytesSchema, transport: "bytes" }),
  adminUserPatch: a("PATCH", "/api/admin/users/:u", { params: user, query: none, body: z.strictObject({ name: z.string().optional(), suspended: z.boolean().optional(), operator: z.boolean().optional(), ...version }), output: UserSchema }),
  adminUserInvite: a("POST", "/api/admin/users/invite", { params: none, query: none, body: z.strictObject({ name: z.string(), email: z.email() }), output: UserSchema, ...key }),
  adminUserTransfer: a("POST", "/api/admin/users/:u/transfer", { params: user, query: none, body: z.strictObject({ projectId: id, to: id, ...version }), output: ok, ...key }),
  adminUserRevoke: a("POST", "/api/admin/users/:u/revoke-sessions", { params: user, query: none, body: existing, output: ok }),
  adminUserRestore: a("POST", "/api/admin/users/:u/restore", { params: user, query: none, body: existing, output: UserSchema }),
  adminProjects: k("GET", "/api/admin/projects", { params: none, query: list.extend({ url: z.string().optional() }), body: noBody, output: pageSchema(ProjectSchema) }),
  adminDeletedProjects: k("GET", "/api/admin/projects/deleted", { params: none, query: list.extend({ ownerId: id.optional() }), body: noBody,
    output: pageSchema(z.strictObject({ id, name: z.string(), ownerId: id, deletedAt: InstantSchema, version: CountSchema })) }),
  adminProjectRestore: k("POST", "/api/admin/projects/:id/restore", { params: ids, query: none,
    body: z.strictObject({ confirmation: z.string(), ...version }), output: ProjectSchema, ...key }),
  adminEditorState: a("POST", "/api/admin/editor-state", { params: none, query: none, body: z.strictObject({ closed: z.boolean(), message: z.string(), ...version }), output: ok }),
  adminEditorStateGet: a("GET", "/api/admin/editor-state", { params: none, query: none, body: noBody,
    output: z.strictObject({ closed: z.boolean(), message: z.string(), version: CountSchema }) }),
  workersList: r("GET", "/api/admin/workers", { params: none, query: list, body: noBody, output: pageSchema(WorkerSchema) }),
  workerPolicyGet: r("GET", "/api/admin/workers/policy", { params: none, query: none, body: noBody,
    output: z.strictObject({ min: CountSchema, max: CountSchema, timeoutSeconds: z.number().int().positive().max(600),
      sandbox: z.enum(["bwrap", "docker"]), version: CountSchema,
      pools: z.array(z.strictObject({ id, name: z.string() })) }) }),
  workersCreate: r("POST", "/api/admin/workers", { params: none, query: none, body: z.strictObject({ poolId: id, count: z.number().int().positive() }), output: OperationSchema, ...key, successStatus: 202 }),
  workerPolicy: r("PATCH", "/api/admin/workers/policy", { params: none, query: none, body: z.strictObject({ min: CountSchema, max: CountSchema, timeoutSeconds: z.number().int().positive().max(600), sandbox: z.enum(["bwrap", "docker"]), ...version }), output: ok }),
  workerDrain: r("POST", "/api/admin/workers/:id/drain", { params: ids, query: none, body: existing, output: OperationSchema, ...key, successStatus: 202 }),
  workerDelete: r("DELETE", "/api/admin/workers/:id", { params: ids, query: none, body: existing, output: ok }),
  adminEnvironments: r("GET", "/api/admin/environments", { params: none, query: list, body: noBody, output: pageSchema(EnvironmentSchema) }),
  environmentCreate: r("POST", "/api/admin/environments", { params: none, query: none, body: z.strictObject({ manifest: EnvironmentSchema.unwrap().omit({ available: true, probeAt: true }) }), output: EnvironmentSchema, ...key }),
  environmentDefault: r("POST", "/api/admin/environments/:id/default", { params: ids, query: none, body: existing, output: ok }),
  environmentRetire: r("POST", "/api/admin/environments/:id/retire", { params: ids, query: none, body: existing, output: ok }),
  environmentBuild: r("POST", "/api/admin/environments/build", { params: none, query: none, body: z.strictObject({ baseId: id, packageList: z.array(z.string()), fontUploads: z.array(id), mirror: z.url() }), output: OperationSchema, ...key, successStatus: 202 }),
  providerGet: r("GET", "/api/admin/providers/:kind", { params: provider, query: none, body: noBody, output: ProviderConfigSchema }),
  providerPut: r("PUT", "/api/admin/providers/:kind", { params: provider, query: none, body: z.strictObject({ baseUrl: z.url(), model: z.string().optional(), secret: z.string().optional(), policy: PolicySchema, ...version }), output: ProviderConfigSchema, ifMatch: true }),
  providerTest: r("POST", "/api/admin/providers/:kind/test", { params: provider, query: none, body: existing, output: z.strictObject({ ok: z.boolean(), reason: z.string().optional() }) }),
  auditList: a("GET", "/api/admin/audit", { params: none, query: list.extend({ event: z.string().optional(), from: InstantSchema.optional(), to: InstantSchema.optional() }), body: noBody, output: pageSchema(AuditEntrySchema) }),
  auditExport: a("POST", "/api/admin/audit/export", { params: none, query: none, body: z.strictObject({ event: z.string().optional(), from: InstantSchema.optional(), to: InstantSchema.optional() }), output: OperationSchema, ...key, successStatus: 202 }),
  auditSiem: r("PUT", "/api/admin/audit/siem", { params: none, query: none, body: z.strictObject({ endpoint: z.url(), secret: z.string().optional(), enabled: z.boolean(), ...version }), output: ok, ifMatch: true }),
  auditSiemGet: r("GET", "/api/admin/audit/siem", { params: none, query: none, body: noBody,
    output: z.strictObject({ endpoint: z.string(), secretPresent: z.boolean(), enabled: z.boolean(), version: CountSchema }) }),
  backupPolicyGet: r("GET", "/api/admin/backups/policy", { params: none, query: none, body: noBody, output: z.strictObject({ schedule: z.string(), retentionDays: CountSchema, destination: z.string(), version: CountSchema }) }),
  backupPolicyPut: r("PUT", "/api/admin/backups/policy", { params: none, query: none, body: z.strictObject({ schedule: z.string(), retentionDays: CountSchema, destination: z.string(), ...version }), output: ok, ifMatch: true }),
  backupCreate: r("POST", "/api/admin/backups", { params: none, query: none, body: none, output: BackupSchema, ...key, successStatus: 202 }),
  backupsList: r("GET", "/api/admin/backups", { params: none, query: list, body: noBody, output: pageSchema(BackupSchema) }),
  backupVerify: r("POST", "/api/admin/backups/:id/verify", { params: ids, query: none, body: existing, output: OperationSchema, ...key, successStatus: 202 }),
  backupRestore: r("POST", "/api/admin/backups/:id/restore", { params: ids, query: none, body: z.strictObject({ target: z.string(), confirmation: z.string(), ...version }), output: OperationSchema, ...key, successStatus: 202 }),
  releasesList: r("GET", "/api/admin/releases", { params: none, query: list, body: noBody, output: pageSchema(ReleaseSchema) }),
  updateCreate: r("POST", "/api/admin/updates", { params: none, query: none, body: z.strictObject({ releaseId: id, at: InstantSchema, autoSecurity: z.boolean() }), output: OperationSchema, ...key, successStatus: 202 }),
  diagnosticsCreate: r("POST", "/api/admin/diagnostics", { params: none, query: none, body: none, output: OperationSchema, ...key, successStatus: 202 }),
  supportInquiry: r("POST", "/api/support/inquiries", { params: none, query: none, body: z.strictObject({ name: z.string(), email: z.email(), organization: z.string(), users: CountSchema, runtime: z.string(), airGapped: z.boolean(), message: z.string() }), output: ok, ...key }),
} as const;
