import type { Environment } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { probeEnvironment } from "../../services/compiler/environment";
import { probeImage, manifestFromProbe } from "../../services/operations/environments/probe";
import { profileFor } from "../../services/operations/environments/model";
import { runProfile } from "../../services/operations/environments/execution";
import { build } from "./build";
import type { BuildInput } from "./build";

export function assertEnvironmentIdentity(expected: Environment, actual: Environment): void {
  if (!expected.available || !actual.available || expected.backend !== actual.backend
    || expected.rootOrImageDigest !== actual.rootOrImageDigest || expected.packagesDigest !== actual.packagesDigest
    || expected.release !== actual.release
    || expected.engines.some(engine => !actual.engines.includes(engine))
    || expected.helpers.some(helper => !actual.helpers.includes(helper))) {
    throw new ServiceError("WORKER_ENVIRONMENT_MISMATCH", 503, "Worker toolchain differs from its provisioned manifest");
  }
}

export async function workerEnvironments(configured: readonly Environment[] | undefined, signal: AbortSignal) {
  if (!configured) {
    const native = await probeEnvironment(signal);
    signal.throwIfAborted();
    assertEnvironmentIdentity(native, native);
    return new Map([[native.id, native]]);
  }
  const environments = new Map<Environment["id"], Environment>();
  let native: Environment | undefined;
  for (const environment of configured) {
    signal.throwIfAborted();
    if (environments.has(environment.id)) throw new ServiceError("DUPLICATE_ENVIRONMENT", 422, "Worker environment IDs must be unique");
    let actual: Environment;
    switch (environment.backend) {
      case "bwrap":
        native ??= await probeEnvironment(signal);
        actual = native;
        break;
      case "docker":
        actual = manifestFromProbe({ id: environment.id, label: environment.label,
          report: await probeImage(environment.rootOrImageDigest, profileFor(environment), signal) });
        break;
    }
    signal.throwIfAborted();
    assertEnvironmentIdentity(environment, actual);
    environments.set(environment.id, environment);
  }
  return environments;
}

export function buildEnvironment(input: BuildInput & { readonly environment: Environment }) {
  return input.environment.backend === "docker" ? runProfile(input) : build(input);
}
