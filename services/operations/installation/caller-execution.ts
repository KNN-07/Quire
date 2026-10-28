import { IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { SandboxInput, SandboxResult } from "../../../workers/compiler/sandbox";
import { installationExecutionContext } from "./caller-execution-context";
import { installationRoleSession } from "./launch";
import { collectInstallationExecution } from "./caller-execution-output";
import type { ExecutionWork } from "./execution-model";

/** Controlled execution never falls back to a caller-selected command or manager. */
export async function installationSandbox(
  input: Pick<SandboxInput, "source" | "limits" | "signal" | "onStderr" | "installationWork" | "installationProfile">,
  backend: "bwrap" | "docker", image?: string,
): Promise<(SandboxResult & { readonly image: string | null }) | null> {
  if (!installationRoleSession()) return null;
  if (!input.installationWork) throw new ServiceError("UPDATES_EXECUTION_RECIPE_REQUIRED", 503, "No approved fixed execution recipe");
  input.signal?.throwIfAborted();
  const selected = await installationExecutionContext({
    kind: input.installationWork.kind, backend, limits: input.limits,
    profile: input.installationProfile ?? "default", ...(image ? { image } : {}),
  });
  if (!selected) throw new ServiceError("CONTROL_LAUNCH_REQUIRED", 503, "Controlled role is unavailable");
  const { createInstallationExecutionClient, describeExecutionSource } = await import("./execution-client");
  const source = await describeExecutionSource(input.source, input.limits.workspaceBytes);
  input.signal?.throwIfAborted();
  const work: ExecutionWork = { ...input.installationWork, source };
  const execution = await createInstallationExecutionClient(selected.session).start({
    requestId: IdSchema.parse(crypto.randomUUID()), profileId: selected.profileId, work, limits: input.limits,
  });
  const result = await collectInstallationExecution(execution, {
    ...(input.signal ? { signal: input.signal } : {}), ...(input.onStderr ? { onStderr: input.onStderr } : {}),
  });
  const started = await execution.started;
  return { stdout: result.stdout, stderr: result.stderr, code: result.code, canceled: result.canceled,
    unit: started.launch.unit, image: result.image };
}
