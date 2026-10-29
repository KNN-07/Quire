import { IdSchema } from "@quire/contracts";
import type { Environment, Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import { installationRoleSession } from "../installation/launch";
import { loadInstallationRole } from "../installation/binding";
import { signedEnvironmentAdmission } from "../installation/environment-admission";
import { environmentRecord, resolveEnvironment } from "./registry";
import { managedWorkerPool } from "../workers/admission";

type AdmissionContext = Pick<ModuleContext, "db" | "services" | "config">;
export async function executionAdmission(context: AdmissionContext, environment: Environment) {
  const session = installationRoleSession();
  if (!session) return { state: "unmanaged" as const, releaseId: null, route: null };
  const { manifest } = await loadInstallationRole(session.permit.binding, session.permit.execution.role);
  const managed = context.config.profile === "scale" || await managedWorkerPool(context.db);
  const route = signedEnvironmentAdmission(manifest, environment, managed ? undefined : session.permit.execution.role);
  return { state: route ? "admitted" as const : "not-admitted" as const,
    releaseId: session.permit.binding.release.releaseId, route };
}

export async function requireEnvironmentAdmission(context: AdmissionContext, environment: Environment): Promise<void> {
  if ((await executionAdmission(context, environment)).state === "not-admitted") {
    throw new ServiceError("ENVIRONMENT_NOT_ADMITTED", 409,
      "Toolchain probes do not grant execution. An operator must admit this exact environment and image in a signed release.");
  }
}

export async function environmentAdmission(context: AdmissionContext, id: Id) {
  const record = await environmentRecord(context, id);
  let probe: "ready" | "unavailable" | "untrusted" = record.manifest.available ? "ready" : "unavailable";
  if (probe === "ready") {
    try { await resolveEnvironment(context, id); }
    catch (error) {
      if (!(error instanceof ServiceError) || error.code !== "ENVIRONMENT_UNTRUSTED") throw error;
      probe = "untrusted";
    }
  }
  const execution = await executionAdmission(context, record.manifest);
  return { environment: record.manifest, probe, execution,
    selectable: probe === "ready" && execution.state !== "not-admitted",
    version: record.version, isDefault: record.isDefault, retiredAt: record.retiredAt };
}

export async function listEnvironmentAdmissions(context: AdmissionContext) {
  const rows = await context.db.all<{ id: string }>("SELECT id FROM environments ORDER BY id");
  return Promise.all(rows.map(row => environmentAdmission(context, IdSchema.parse(row.id))));
}
