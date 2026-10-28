import { z } from "zod";
import { endpoints as routes } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ServiceModule } from "@quire/runtime";
import { defineAction } from "../shared";
import type { AdapterContribution, AdapterDefinition, GrantContext } from "../shared";
import { DropboxApi, dropboxEndpoints } from "./api";
import type { DropboxEndpoints } from "./api";
import { parameters as syncParameters } from "./model";
import { migrations } from "./migrations";
import { DropboxSync } from "./sync";
import { DropboxScheduler } from "./scheduler";
import { recoverDropbox } from "./recovery";
import { actor } from "../../core/base/http";

export type DropboxOptions = {
  readonly appKey?: string;
  /** The operator confirms the Dropbox registration is App Folder access, named Quire. */
  readonly appFolder?: "Apps/Quire";
  /** Trusted composition/test injection, never a user-supplied URL. */
  readonly endpoints?: DropboxEndpoints;
};
export function createDropboxIntegration(options: DropboxOptions = {}) {
  let sync: DropboxSync | undefined;
  let scheduler: DropboxScheduler | undefined;
  let recover: (() => ReturnType<typeof recoverDropbox>) | undefined;
  let recovery: Awaited<ReturnType<typeof recoverDropbox>> = [];
  const contribution: AdapterContribution = services => {
    if (sync) throw new ServiceError("DUPLICATE_DROPBOX_ASSEMBLY", 500, "Create fresh Dropbox integration per runtime");
    const endpoints = options.endpoints ?? dropboxEndpoints;
    const engine = new DropboxSync(services, endpoints);
    sync = engine;
    const api = (context: GrantContext) => new DropboxApi(services.http, endpoints, context);
    const definition: AdapterDefinition = {
      kind: "dropbox", label: "Dropbox",
      configuration: settings => [
        ...(!options.appKey ? ["Dropbox App Console app key"] : []),
        ...(!settings.secret ? ["Dropbox App Console app secret"] : []),
        ...(options.appFolder !== "Apps/Quire" ? ["Dropbox App Folder registration named Quire (Apps/Quire)"] : []),
        ...(Bun.which("git") === null ? ["Git CLI executable on PATH for core source checkpoints"] : []),
        ...(settings.baseUrl && new URL(settings.baseUrl).origin !== new URL(endpoints.rpc).origin
          ? [`Dropbox API base URL ${new URL(endpoints.rpc).origin}`] : []),
      ],
      oauth: settings => {
        if (!options.appKey || !settings.secret) throw new ServiceError("PROVIDER_UNCONFIGURED", 503, "Dropbox app key and secret required");
        return { authorizationUrl: endpoints.authorization, tokenUrl: endpoints.token,
          clientId: options.appKey, clientSecret: settings.secret, tokenAuthentication: "body",
          scopes: ["files.metadata.read", "files.content.read", "files.content.write"],
          authorizationParameters: { token_access_type: "offline" } };
      },
      actions: {
        initialSync: defineAction(syncParameters, { projectAccess: "owner",
          prepare: (parameters, context) => engine.prepare({ action: "initialSync", parameters, context }) }),
        sync: defineAction(syncParameters, { projectAccess: "owner",
          prepare: (parameters, context) => engine.prepare({ action: "sync", parameters, context }) }),
        disconnect: defineAction(z.strictObject({}), { projectAccess: "owner",
          async prepare(_parameters, context) {
            if (!context.projectId) throw new ServiceError("PROJECT_REQUIRED", 400, "Dropbox requires a project");
            const projectId = context.projectId;
            if (await engine.store.pending(context.grant.id, projectId)) {
              throw new ServiceError("DROPBOX_RECOVERY_REQUIRED", 409, "Reconcile pending synchronization before disconnecting the project");
            }
            return { result: { disconnected: true, projectId }, cursor: null, publish: async tx => {
              await tx.run("UPDATE dropbox_sync SET enabled=0 WHERE grant_id=? AND project_id=?", [context.grant.id, projectId]);
            } };
          },
        }),
      },
      async test(context) { await api(context).list({ root: "", cursor: null, remote: [] }); return { ok: true }; },
      revoke: context => api(context).revoke(),
      close: async () => { await scheduler?.close(); },
    };
    scheduler = new DropboxScheduler(services, definition);
    recover = () => recoverDropbox(services, definition);
    return definition;
  };
  const module: ServiceModule = { id: "064-x-dropbox", lane: "X", order: 64, migrations,
    async register(context) {
      if (!recover) throw new ServiceError("DROPBOX_ORDER_INVALID", 500, "Register shared adapters before Dropbox");
      recovery = await recover();
      const engine = sync;
      if (!engine) throw new ServiceError("DROPBOX_ORDER_INVALID", 500, "Register Dropbox contribution first");
      context.routes.register(routes.dropboxPolicyGet, async (input, request) =>
        engine.policies.get({ actorId: await actor(context, request), scope: { kind: input.params.scopeKind, id: input.params.id } }));
      context.routes.register(routes.dropboxPolicyPut, async (input, request) => {
        const principal = { actorId: await actor(context, request), scope: { kind: input.params.scopeKind, id: input.params.id } };
        await engine.policies.set({ ...principal, ...input.body });
        return engine.policies.get(principal);
      });
    } };
  return { contribution, module,
    get recoveryFailures() { return recovery; },
    get policies() { if (!sync) throw new TypeError("Dropbox not registered"); return sync.policies; },
    get scheduler() { if (!scheduler) throw new TypeError("Dropbox not registered"); return scheduler; },
  };
}
export { migrations } from "./migrations";
export { DropboxApi, DropboxError, dropboxEndpoints } from "./api";
export type { DropboxEndpoints } from "./api";
export { DropboxPolicies } from "./policy";
export { DropboxScheduler } from "./scheduler";
export type { TickSource } from "./scheduler";
