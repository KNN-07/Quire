import { z } from "zod";
import { ControlError } from "./model";
import { installationRoleSession } from "./launch";
import { ExecutionTaskSchema } from "./execution-model";
import type { ExecutionLimitsSchema, ExecutionWork } from "./execution-model";

export type InstallationRecipe = {
  [Kind in Exclude<ExecutionWork["kind"], "worker">]: Omit<Extract<ExecutionWork, { readonly kind: Kind }>, "source">;
}[Exclude<ExecutionWork["kind"], "worker">];

/** Caller adaptation: select a unique signed recipe for the actual live invocation. */
export async function installationExecutionContext(input: {
  readonly kind: ExecutionWork["kind"];
  readonly backend: "bwrap" | "docker" | "worker";
  readonly image?: string;
  readonly profile?: "default" | "restricted" | "knitr";
  readonly limits?: z.infer<typeof ExecutionLimitsSchema>;
}) {
  const session = installationRoleSession();
  if (!session) return null;
  const { loadInstallationRole } = await import("./binding");
  const task = z.object({ task: ExecutionTaskSchema.optional() }).parse(session.permit).task;
  const role = task?.request.work.kind === "worker" ? task.profile.workerRole : session.permit.execution.role;
  if (!role) throw new ControlError("CONTROL_WORKER_FACTORY_REQUIRED");
  const { manifest } = await loadInstallationRole(session.permit.binding, role);
  if (manifest.installationId !== session.permit.execution.installationId) throw new ControlError("CONTROL_BINDING_MISMATCH");
  const allowed = (manifest.executionProfiles ?? []).filter(profile =>
    profile.roles.includes(role) && profile.kinds.includes(input.kind) && profile.backend === input.backend &&
    (input.profile === undefined || profile.profile === input.profile));
  const exact = allowed.filter(profile => input.image === undefined || profile.image === input.image);
  // A derived immutable image is selected by ID, not promoted to authority here.
  // The controller must resolve it through its successful owned-build ledger
  // and reapply the current inherited signed profile before any launch.
  const profiles = exact.length ? exact : allowed;
  if (profiles.length !== 1) throw new ControlError("UPDATES_EXECUTION_PROFILE_UNAVAILABLE", "Exactly one signed execution profile must match");
  const profile = profiles[0];
  if (!profile || input.limits && Object.entries(input.limits).some(([key, value]) =>
    value > profile.limits[z.enum(["wallSeconds", "memoryBytes", "processes", "workspaceBytes"]).parse(key)])) {
    throw new ControlError("CONTROL_EXECUTION_LIMITS");
  }
  return { session, profile, profileId: input.image !== undefined && profile.image !== input.image ? input.image : profile.id };
}
