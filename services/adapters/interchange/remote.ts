import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { assertNever } from "@quire/contracts";
import { GrantStore } from "../shared";
import type { RemoteImporter } from "./imports";

/** Dispatch to the actual shared contribution; never clone repositories here. */
export function sharedRemoteImporter(context: ModuleContext): RemoteImporter {
  const grants = new GrantStore(context);
  return async (actorId, input, receipt) => {
    if (input.source instanceof File) throw new ServiceError("INVALID_GIT_SOURCE", 422, "Remote import needs a Git source, not a file");
    switch (input.source.kind) {
      case "git": {
        const source = input.source;
        if (!source.grantId) throw new ServiceError("GIT_GRANT_REQUIRED", 503,
          "Save a GitHub or repository-bound Git connection in Settings before importing.");
        if (!context.services.has("adapters")) throw new ServiceError("REMOTE_IMPORT_REQUIRED", 503,
          "Register shared adapters with the actual remote Git contributions before interchange");
        const routes = { github: { provider: "github", action: "import" }, git: { provider: "git", action: "clone" } } as const;
        const { provider, action } = routes[input.kind];
        const adapter = context.services.get("adapters").get(provider);
        if (!adapter) throw new ServiceError("REMOTE_IMPORT_REQUIRED", 503, `Install the shared ${provider} contribution`);
        const grant = await grants.read(actorId, source.grantId);
        if (grant.provider !== provider) throw new ServiceError("GRANT_PROVIDER_MISMATCH", 400, "Connection belongs to another provider");
        return adapter.execute({
          actorId, grantId: grant.id, action,
          expectedCursor: null, expectedVersion: grant.version, key: receipt.key,
          parameters: { name: input.name, url: source.url, branch: source.branch,
            ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
            ...(input.mainPath ? { mainPath: input.mainPath } : {}),
            ...(input.engine ? { engine: input.engine } : {}),
            ...(input.environmentId ? { environmentId: input.environmentId } : {}),
            ...(input.preserveHistory !== undefined ? { preserveHistory: input.preserveHistory } : {}),
            ...(input.keepConnected !== undefined ? { keepConnected: input.keepConnected } : {}) },
        });
      }
      case "upload":
      case "snippet":
      case "url":
      case "data-url": throw new ServiceError("INVALID_GIT_SOURCE", 422, "Remote import requires source.kind=git");
      default: return assertNever(input.source);
    }
  };
}
