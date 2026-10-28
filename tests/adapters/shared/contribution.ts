import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { defineAction } from "../../../services/adapters/shared";
import type { AdapterContribution } from "../../../services/adapters/shared";

export function fixtureContribution(options: {
  readonly publicationFailure?: boolean; readonly projectAccess?: "none" | "read" | "write" | "owner";
} = {}): AdapterContribution {
  return (services) => ({
    kind: "fixture", label: "Protocol fixture",
    configuration: (settings) => settings.secret ? [] : ["OAuth fixture client secret"],
    oauth: (settings) => ({
      authorizationUrl: `${settings.baseUrl}/authorize`, tokenUrl: `${settings.baseUrl}/token`,
      revokeUrl: `${settings.baseUrl}/revoke`, clientId: "fixture-client",
      ...(settings.secret ? { clientSecret: settings.secret } : {}),
      scopes: ["read", "write"], tokenAuthentication: "body",
    }),
    probe: async (settings) => {
      await services.http.json(`${settings.baseUrl}/probe`, z.object({ protocol: z.literal("fixture-oauth2") }));
      return { ok: true };
    },
    test: async (context) => {
      await services.http.json(`${context.configuration.baseUrl}/me`, z.object({ id: z.string(), generation: z.number() }),
        { headers: { authorization: `Bearer ${context.tokens.accessToken}` }, signal: context.signal });
      return { ok: true };
    },
    actions: {
      sync: defineAction(z.strictObject({ value: z.string().min(1), branch: z.string().optional() }), {
        projectAccess: options.projectAccess ?? "none",
        async prepare(parameters, context) {
          const response = await services.http.json(`${context.configuration.baseUrl}/action`,
            z.strictObject({ value: z.string(), cursor: z.string() }), {
              method: "POST", headers: { authorization: `Bearer ${context.tokens.accessToken}`,
                "idempotency-key": context.key, "content-type": "application/json" },
              body: JSON.stringify({ value: parameters.value, cursor: context.expectedCursor }), signal: context.signal,
            });
          const notificationId = IdSchema.parse(crypto.randomUUID());
          return { result: { value: response.value }, cursor: response.cursor,
            async publish(tx) {
              await tx.run("INSERT INTO notifications(id,user_id,kind,resource_id,created_at) VALUES(?,?,?,?,?)",
                [notificationId, context.actorId, "fixture.synced", context.grant.id, services.context.clock.now()]);
              if (options.publicationFailure) throw new ServiceError("FIXTURE_PUBLICATION_FAILED", 409, "Injected transactional failure");
            } };
        },
      }),
      leak: defineAction(z.strictObject({}), {
        projectAccess: "none",
        async prepare(_parameters, context) {
          const result = await services.http.json(`${context.configuration.baseUrl}/leak`,
            z.object({ access_token: z.string() }), { headers: { authorization: `Bearer ${context.tokens.accessToken}` } });
          return { result, cursor: null };
        },
      }),
    },
  });
}
