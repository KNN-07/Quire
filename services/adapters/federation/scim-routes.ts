import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import { scimId } from "./scim-store";
import type { ScimStore } from "./scim-store";
import { ScimUsers } from "./scim-users";
import { ScimGroups } from "./scim-groups";
import { etag, matchVersion, patchInput, patchResource, resourceInputs, scimSchemas } from "./scim-schema";
import type { ScimKind } from "./scim-schema";

export function registerScim(context: ModuleContext, store: ScimStore) {
  const handlers = { Users: new ScimUsers(store), Groups: new ScimGroups(store) } satisfies Record<ScimKind, ScimUsers | ScimGroups>;
  async function handle(request: RequestContext, kind: ScimKind) {
    const { request: incoming } = request;
    try {
      // The raw SCIM protocol deliberately bypasses Quire JSON envelopes.
      const body: unknown = incoming.method === "POST" || incoming.method === "PATCH" ? await incoming.json() : undefined;
      const response = await context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        await store.authenticate(incoming, tx);
        const collection = new URL(incoming.url).pathname.replace(/\/$/, "").endsWith(`/${kind}`);
        const headers = new Headers({ "content-type": "application/scim+json", "cache-control": "no-store" });
        if (collection && incoming.method === "GET") return Response.json({ schemas: [scimSchemas.list], ...await store.list(tx, { kind, request: incoming }) }, { headers });
        const handler = handlers[kind];
        if (collection && incoming.method === "POST") {
          const result = await handler.create(tx, body);
          const resource = store.resource(result.row);
          headers.set("etag", etag(result.row.version));
          headers.set("location", resource.meta.location);
          return Response.json(resource, { status: result.created ? 201 : 200, headers });
        }
        const row = await store.get(tx, { kind, id: scimId(incoming) });
        if (incoming.method === "GET") {
          headers.set("etag", etag(row.version));
          return Response.json(store.resource(row), { headers });
        }
        matchVersion(row, incoming);
        if (incoming.method === "DELETE") {
          const data = resourceInputs[kind].parse(JSON.parse(row.data_json));
          await handler.update(tx, { row, body: data, remove: true });
          return new Response(null, { status: 204, headers });
        }
        const patch = patchInput.parse(body);
        const result = await handler.update(tx, { row, body: patchResource(row, patch.Operations) });
        headers.set("etag", etag(result.version));
        return Response.json(store.resource(result), { headers });
      });
      await context.events.dispatch();
      return response;
    } catch (error) {
      if (error instanceof ServiceError || error instanceof z.ZodError || error instanceof SyntaxError) {
        const status = error instanceof ServiceError ? error.status : 400;
        const detail = error instanceof ServiceError ? error.message : "Invalid SCIM request";
        const scimType = error instanceof ServiceError
          ? error.code === "SCIM_FILTER_INVALID" ? "invalidFilter"
            : ["SCIM_EXTERNAL_ID_CONFLICT", "SCIM_EMAIL_CONFLICT"].includes(error.code) ? "uniqueness"
            : error.code === "SCIM_IMMUTABLE" ? "mutability" : undefined
          : "invalidValue";
        return Response.json({ schemas: [scimSchemas.error], status: String(status), detail,
          ...(scimType ? { scimType } : {}) },
        { status, headers: { "content-type": "application/scim+json", "cache-control": "no-store" } });
      }
      throw error;
    }
  }
  for (const route of [endpoints.scimUsersList, endpoints.scimUserCreate, endpoints.scimUserGet, endpoints.scimUserPatch, endpoints.scimUserDelete]) {
    context.routes.registerTransport(route, (request) => handle(request, "Users"));
  }
  for (const route of [endpoints.scimGroupsList, endpoints.scimGroupCreate, endpoints.scimGroupGet, endpoints.scimGroupPatch, endpoints.scimGroupDelete]) {
    context.routes.registerTransport(route, (request) => handle(request, "Groups"));
  }
}
