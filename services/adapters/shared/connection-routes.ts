import { endpoints } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import type { AdapterServices } from "./contracts";
import type { ConfiguredAdapter } from "./configured-adapter";
import { ConnectionOAuth } from "./oauth";
import { authorizeAction } from "./operation-store";

export function registerConnections(
  context: ModuleContext, services: AdapterServices, adapters: ReadonlyMap<string, ConfiguredAdapter>,
): void {
  const oauth = new ConnectionOAuth(services);
  const identity = context.services.get("identity");
  const find = (kind: string) => {
    const adapter = adapters.get(kind);
    if (!adapter) throw new ServiceError("PROVIDER_UNKNOWN", 404, "Provider is not installed");
    return adapter;
  };
  context.routes.register(endpoints.connectionAvailability, async (_input, request) => {
    await identity.require(request.request);
    const entries = await Promise.all([...adapters].map(async ([kind, adapter]) =>
      [kind, await adapter.availability()] as const));
    return Object.fromEntries(entries);
  });
  context.routes.register(endpoints.connectionsList, async (input, request) => {
    const actor = await identity.require(request.request);
    return services.grants.list(actor.user.id, input.query);
  });
  context.routes.register(endpoints.connectionStart, async (input, request) => {
    const actor = await identity.require(request.request);
    await identity.verifyMutation(request.request, actor);
    return oauth.start(find(input.params.provider).definition, actor, input.body.returnTo);
  });
  context.routes.registerTransport(endpoints.connectionCallback, async (request) => {
    const actor = await identity.require(request.request);
    const url = new URL(request.request.url);
    const provider = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const input = endpoints.connectionCallback.input.parse({
      params: { provider }, query: Object.fromEntries(url.searchParams), body: undefined, headers: Object.fromEntries(request.request.headers),
    });
    const returnTo = await oauth.callback(find(provider).definition, actor, input.query);
    return new Response(null, { status: 303, headers: {
      location: returnTo, "cache-control": "no-store", "referrer-policy": "no-referrer",
    } });
  });
  context.routes.register(endpoints.connectionTest, async (input, request) => {
    const actor = await identity.require(request.request);
    await identity.verifyMutation(request.request, actor);
    const grant = await services.grants.read(actor.user.id, input.params.id);
    if (grant.version !== input.body.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Connection changed");
    const adapter = find(grant.provider);
    if (grant.expiresAt && grant.expiresAt <= context.clock.now()) {
      await adapter.refresh({ actorId: actor.user.id, grantId: grant.id, expectedVersion: grant.version });
    }
    return adapter.test(grant.id, actor.user.id);
  });
  context.routes.register(endpoints.connectionCursor, async (input, request) => {
    const principal = await identity.require(request.request);
    const grant = await services.grants.read(principal.user.id, input.params.id);
    const action = find(grant.provider).definition.actions[input.query.action];
    if (!action) throw new ServiceError("ACTION_UNKNOWN", 400, "Provider action is not installed");
    await authorizeAction(context, {
      actorId: principal.user.id, parameters: {},
      ...(input.query.projectId ? { projectId: input.query.projectId } : {}),
    }, action);
    const row = await context.db.get<{ cursor: string | null }>(
      "SELECT cursor FROM adapter_cursors WHERE grant_id=? AND action=? AND project_id=?",
      [grant.id, input.query.action, input.query.projectId ?? ""]);
    return { cursor: row?.cursor ?? null, grantVersion: grant.version };
  });
  context.routes.register(endpoints.connectionDelete, async (input, request) => {
    const actor = await identity.require(request.request);
    await identity.verifyMutation(request.request, actor);
    const grant = await services.grants.read(actor.user.id, input.params.id);
    return find(grant.provider).disconnect({ actorId: actor.user.id, grantId: grant.id, expectedVersion: input.body.expectedVersion });
  });
  context.routes.register(endpoints.connectionAction, async (input, request) => {
    const actor = await identity.require(request.request);
    await identity.verifyMutation(request.request, actor);
    const grant = await services.grants.read(actor.user.id, input.params.id);
    return find(grant.provider).execute({
      actorId: actor.user.id, grantId: grant.id, action: input.body.action, parameters: input.body.parameters,
      expectedVersion: input.body.expectedVersion, expectedCursor: input.body.expectedCursor ?? null,
      key: request.request.headers.get("idempotency-key") ?? "",
      ...(input.body.projectId ? { projectId: input.body.projectId } : {}),
    });
  });
}
