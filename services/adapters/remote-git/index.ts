import { endpoints } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ServiceModule } from "@quire/runtime";
import type {
  AdapterContribution,
  AdapterDefinition,
  AdapterServices,
} from "../shared";
import { defineAction } from "../shared";
import { actor } from "../../core/base/http";
import { migrations } from "./migrations";
import { githubContribution, gitlabContribution } from "./providers";
import { prepareRemoteImport, ImportRemoteSchema } from "./import-project";
import { preparePull, PullRemoteSchema } from "./pull";
import { preparePush, PushRemoteSchema } from "./push";
import { recoverRemoteGit } from "./recovery";
import { RemoteGitStore } from "./store";
import type { RemoteGitOptions } from "./git-process";
import { RemoteRepository } from "./git-process";
import { genericCredentials, registerGenericCredentials } from "./credentials";

export type RemoteGitIntegrationOptions = RemoteGitOptions & {
  /** Standalone-only fallback. Composed applications leave imports to interchange. */
  readonly registerImportRoute?: boolean;
};

function genericContribution(options: RemoteGitOptions): AdapterContribution {
  return (services) => {
    const store = new RemoteGitStore(services);
    const credential = genericCredentials;
    return {
      kind: "git",
      label: "Generic Git",
      configuration: () => Bun.which("git") === null ? ["Git CLI executable on PATH"] : [],
      actions: {
        clone: defineAction(ImportRemoteSchema, {
          projectAccess: "none",
          prepare: (parameters, context) => prepareRemoteImport({
            services,
            store,
            provider: "git",
            parameters,
            context,
            credentials: credential(context.tokens.accessToken),
            options,
          }),
        }),
        fetch: defineAction(PullRemoteSchema, {
          projectAccess: "write",
          prepare: (parameters, context) => preparePull({
            services,
            store,
            provider: "git",
            parameters,
            context,
            credentials: credential(context.tokens.accessToken),
            options,
          }),
        }),
        push: defineAction(PushRemoteSchema, {
          projectAccess: "write",
          prepare: (parameters, context) => preparePush({
            services,
            store,
            provider: "git",
            parameters,
            context,
            credentials: credential(context.tokens.accessToken),
            options,
          }),
        }),
      },
      test: async context => {
        const credentials = credential(context.tokens.accessToken);
        await using remote = await RemoteRepository.open({ url: credentials.repositoryUrl, credentials, options });
        await remote.branches();
        return { ok: true };
      },
      revoke: "local",
    };
  };
}

export function createRemoteGitIntegration(options: RemoteGitIntegrationOptions = {}): {
  readonly contributions: readonly AdapterContribution[];
  readonly module: ServiceModule;
} {
  const {
    registerImportRoute = false,
    ...transportOptions
  } = options;
  let services: AdapterServices | undefined;
  const definitions = new Map<string, AdapterDefinition>();
  const capture = (contribution: AdapterContribution): AdapterContribution => (next) => {
    if (services && services !== next) {
      throw new ServiceError("DUPLICATE_REMOTE_GIT_ASSEMBLY", 500, "Create fresh remote Git integration per runtime");
    }
    services = next;
    const definition = contribution(next);
    definitions.set(definition.kind, definition);
    return definition;
  };
  const contributions = [
    capture(githubContribution(transportOptions)),
    capture(gitlabContribution(transportOptions)),
    capture(genericContribution(transportOptions)),
  ] as const;
  const module: ServiceModule = {
    id: "062-x-remote-git",
    lane: "X",
    order: 62,
    migrations,
    async register(context) {
      if (!services) {
        throw new ServiceError("REMOTE_GIT_ORDER_INVALID", 500, "Shared adapters must register before remote Git");
      }
      const adapterServices = services;
      const store = new RemoteGitStore(adapterServices);
      await recoverRemoteGit(adapterServices, store);
      registerGenericCredentials(context, adapterServices, transportOptions);
      if (!registerImportRoute) return;
      context.routes.register(endpoints.importCreate, async (input, request) => {
        const actorId = await actor(context, request);
        const principal = await context.services.get("identity").require(request.request);
        await context.services.get("identity").verifyMutation(request.request, principal);
        if (input.body.kind !== "git" && input.body.kind !== "github") {
          throw new ServiceError("IMPORT_UNSUPPORTED", 422, "This module handles Git and GitHub imports");
        }
        if (input.body.source instanceof File || input.body.source.kind !== "git") {
          throw new ServiceError("INVALID_GIT_SOURCE", 422, "Git import requires a remote URL, branch and saved grant");
        }
        if (!input.body.source.grantId) {
          throw new ServiceError(
            "GIT_GRANT_REQUIRED",
            503,
            "Saved credentials are required; generic non-OAuth enrollment is not present in the shared contract",
          );
        }
        const provider = input.body.kind === "github" ? "github" : "git";
        const definition = definitions.get(provider);
        if (!definition) throw new ServiceError("PROVIDER_UNKNOWN", 404, "Remote Git provider is not installed");
        const grant = await adapterServices.grants.read(actorId, input.body.source.grantId);
        if (grant.provider !== provider) {
          throw new ServiceError("GRANT_PROVIDER_MISMATCH", 400, "Connection belongs to another provider");
        }
        const parameters = {
          name: input.body.name,
          url: input.body.source.url,
          branch: input.body.source.branch,
          ...(input.body.workspaceId ? { workspaceId: input.body.workspaceId } : {}),
        };
        return adapterServices.operations.execute(definition, {
          actorId,
          grantId: grant.id,
          action: provider === "git" ? "clone" : "import",
          parameters,
          expectedCursor: null,
          expectedVersion: grant.version,
          key: request.request.headers.get("idempotency-key") ?? "",
        });
      });
    },
  };
  return { contributions, module };
}

export { githubContribution, gitlabContribution } from "./providers";
export { migrations } from "./migrations";
export { RemoteRepository } from "./git-process";
export type { RemoteGitOptions, GitCredentials } from "./git-process";
export { RepositorySummarySchema, RemoteBindingSchema, BindingCursorSchema } from "./types";
