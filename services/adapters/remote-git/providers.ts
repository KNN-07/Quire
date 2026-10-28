import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import type { AdapterContribution } from "../shared";
import { defineAction } from "../shared";
import { prepareRemoteExport, ExportRemoteSchema } from "./export-new";
import { prepareRemoteImport, ImportRemoteSchema } from "./import-project";
import { preparePull, PullRemoteSchema } from "./pull";
import { preparePush, PushRemoteSchema } from "./push";
import { RemoteGitStore } from "./store";
import type { RemoteGitOptions } from "./git-process";
import { githubClient } from "./github-client";
import { gitlabClient } from "./gitlab-client";
import { gitCredentials } from "./provider-client";

const listSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(50),
}).readonly();
const disconnectSchema = z.strictObject({
  expectedBindingVersion: z.number().int().nonnegative(),
}).readonly();

function providerContribution(
  provider: "github" | "gitlab",
  options: RemoteGitOptions,
): AdapterContribution {
  return (services) => {
    const client = provider === "github" ? githubClient(services) : gitlabClient(services);
    const store = new RemoteGitStore(services);
    return {
      kind: provider,
      label: provider === "github" ? "GitHub" : "GitLab",
      configuration: (settings) => [
        ...(settings.model ? [] : [`${provider} OAuth client ID (model field)`]),
        ...(settings.secret ? [] : [`${provider} OAuth client secret`]),
      ],
      oauth: (settings) => ({
        authorizationUrl: new URL(
          provider === "github" ? "/login/oauth/authorize" : "/oauth/authorize",
          settings.baseUrl,
        ).href,
        tokenUrl: new URL(
          provider === "github" ? "/login/oauth/access_token" : "/oauth/token",
          settings.baseUrl,
        ).href,
        ...(provider === "gitlab"
          ? { revokeUrl: new URL("/oauth/revoke", settings.baseUrl).href }
          : {}),
        clientId: settings.model ?? "",
        ...(settings.secret ? { clientSecret: settings.secret } : {}),
        scopes: provider === "github" ? ["repo", "read:user"] : ["api"],
        tokenAuthentication: "body",
      }),
      test: async (context) => {
        await client.test(context);
        return { ok: true };
      },
      ...(client.revoke ? { revoke: client.revoke } : {}),
      actions: {
        listRepositories: defineAction(listSchema, {
          projectAccess: "none",
          async prepare(parameters, context) {
            const listed = await client.list(context, parameters.limit, context.expectedCursor);
            return {
              result: { repositories: listed.repositories, nextCursor: listed.cursor },
              cursor: listed.cursor,
            };
          },
        }),
        import: defineAction(ImportRemoteSchema, {
          projectAccess: "none",
          prepare: (parameters, context) => prepareRemoteImport({
            services,
            store,
            provider,
            parameters,
            context,
            credentials: gitCredentials(provider, context),
            options,
          }),
        }),
        exportNew: defineAction(ExportRemoteSchema, {
          projectAccess: "write",
          async prepare(parameters, context) {
            const created = await client.create(context, parameters);
            return prepareRemoteExport({
              services,
              store,
              provider,
              parameters,
              context,
              created,
              credentials: gitCredentials(provider, context),
              options,
            });
          },
        }),
        pull: defineAction(PullRemoteSchema, {
          projectAccess: "write",
          prepare: (parameters, context) => preparePull({
            services,
            store,
            provider,
            parameters,
            context,
            credentials: gitCredentials(provider, context),
            options,
          }),
        }),
        push: defineAction(PushRemoteSchema, {
          projectAccess: "write",
          prepare: (parameters, context) => preparePush({
            services,
            store,
            provider,
            parameters,
            context,
            credentials: gitCredentials(provider, context),
            options,
          }),
        }),
        disconnect: defineAction(disconnectSchema, {
          projectAccess: "owner",
          async prepare(parameters, context) {
            if (!context.projectId) {
              throw new ServiceError("PROJECT_REQUIRED", 400, "Disconnect requires a project");
            }
            const binding = await store.binding({
              actorId: context.actorId,
              projectId: context.projectId,
              provider,
              grantId: context.grant.id,
            });
            if (binding.version !== parameters.expectedBindingVersion) {
              throw new ServiceError("VERSION_CONFLICT", 409, "Remote binding changed");
            }
            return {
              result: { disconnected: true, bindingId: binding.id },
              cursor: null,
              async publish(tx) {
                const removed = await tx.run(
                  "DELETE FROM remote_bindings WHERE id=? AND version=?",
                  [binding.id, binding.version],
                );
                if (removed.changes !== 1) {
                  throw new ServiceError("VERSION_CONFLICT", 409, "Remote binding changed");
                }
              },
            };
          },
        }),
      },
    };
  };
}

export function githubContribution(options: RemoteGitOptions = {}): AdapterContribution {
  return providerContribution("github", options);
}

export function gitlabContribution(options: RemoteGitOptions = {}): AdapterContribution {
  return providerContribution("gitlab", options);
}
