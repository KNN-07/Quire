import { z } from "zod";
import { endpoints, IdentityConfigSchema, resourceVersionTag } from "@quire/contracts";
import type { IdentityConfig, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal, RequestContext } from "@quire/runtime";
import { enrollBreakGlass } from "../../accounts/identity";
import { authentication } from "../../accounts/identity/authentication";
import { hash, newId, secret, store } from "../../accounts/identity/store";
import { SecretBox } from "../shared/secrets";
import { FederationConfigurations } from "./configuration";
import { FederationSaml } from "./saml";
import type { FederationServices } from "./oidc";
import type { FederationHandshakeTests } from "./handshake-tests";

export async function operator(context: ModuleContext, request: RequestContext, mutation = true) {
  const auth = authentication(context, store(context));
  const principal = mutation ? await auth.mutation(request.request) : await auth.port.require(request.request);
  if (!principal.operator) throw new ServiceError("OPERATOR_REQUIRED", 403, "Operator required");
  if (mutation) await auth.fresh(principal);
  return principal;
}
export async function activeOperator(context: ModuleContext, tx: Transaction, principal: Principal) {
  const active = await tx.get(`SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND s.created_at>? AND u.operator=1 AND u.suspended=0 AND u.deleted_at IS NULL`,
  [principal.sessionId, principal.user.id, context.clock.now(), new Date(Date.parse(context.clock.now()) - 900_000).toISOString()]);
  if (!active) throw new ServiceError("FRESH_AUTH_REQUIRED", 403, "Fresh active operator required");
}
export function registerAdministration(services: FederationServices, tests: FederationHandshakeTests) {
  const { context, configurations } = services;
  const repository = store(context);
  context.routes.register(endpoints.identityTest, async ({ body }, request) =>
    tests.start(request, await operator(context, request), body));
  context.routes.register(endpoints.identityConfigGet, async (_input, request) => {
    await operator(context, request, false);
    const { config } = await configurations.get();
    request.responseHeaders.set("etag", resourceVersionTag(config.version));
    return config;
  });
  context.routes.register(endpoints.identityConfigPut, async ({ body }, request) => {
    const principal = await operator(context, request);
    if (request.request.headers.get("if-match") !== resourceVersionTag(body.expectedVersion)) throw new ServiceError("VERSION_CONFLICT", 409, "If-Match and expectedVersion must match");
    const { expectedVersion, oidcSecret, ldapSecret, ...draft } = body;
    const config = IdentityConfigSchema.parse({ ...draft, version: expectedVersion });
    const result = await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await activeOperator(context, tx, principal);
      const current = await configurations.get(tx);
      const saved = await configurations.save(tx, { config, oidcSecret: oidcSecret ?? current.oidcSecret,
        ldapSecret: ldapSecret ?? current.ldapSecret });
      await auditConfiguration(context, tx, { principal, version: saved.version });
      return saved;
    });
    await context.events.dispatch();
    request.responseHeaders.set("etag", resourceVersionTag(result.version));
    return result;
  });
  context.routes.registerTransport(endpoints.identityMetadata, async (request) => {
    await operator(context, request, false);
    const { config } = await configurations.get();
    return new Response(new FederationSaml(context).client(config).generateServiceProviderMetadata(null, null),
      { headers: { "content-type": "application/samlmetadata+xml", "cache-control": "no-store" } });
  });
  context.routes.register(endpoints.scimToken, async (_input, request) => {
    const principal = await operator(context, request);
    const token = secret();
    const box = new SecretBox(context.secretKey);
    const result = await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await activeOperator(context, tx, principal);
      return repository.idempotent(tx, { actor: principal.user.id, route: "/api/admin/scim/token",
        key: request.request.headers.get("idempotency-key") ?? "", body: {},
        schema: z.object({ id: z.string().uuid(), encrypted: z.string() }) }, async () => {
        const id = newId();
        await tx.run("UPDATE federation_tokens SET revoked_at=? WHERE revoked_at IS NULL", [context.clock.now()]);
        await tx.run("INSERT INTO federation_tokens(id,token_hash,created_at) VALUES(?,?,?)", [id, hash(token), context.clock.now()]);
        await tx.run("INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json) VALUES(?,?,?,?,?,?)",
          [newId(), context.clock.now(), principal.user.id, "scim.token.rotated", id, "{}"]);
        // The idempotency receipt must never persist a plaintext bearer secret.
        return { id, encrypted: Buffer.from(box.seal(token, `scim-token:${id}`)).toString("base64") };
      });
    });
    return { id: result.id, secretOnce: box.open(Buffer.from(result.encrypted, "base64"), `scim-token:${result.id}`) };
  });
}
async function auditConfiguration(context: ModuleContext, tx: Transaction, input: { readonly principal: Principal; readonly version: number }) {
  await tx.run("INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json) VALUES(?,?,?,?,?,?)",
    [newId(), context.clock.now(), input.principal.user.id, "federation.configured", input.principal.user.id, JSON.stringify({ version: input.version })]);
}
export async function enrollFederationBreakGlass(context: ModuleContext, request: RequestContext, password: string) {
  const principal = await operator(context, request);
  await enrollBreakGlass(context, { principal, password });
  return { ok: true as const, version: 0 };
}
export async function rotateFederationCertificates(services: FederationServices, request: RequestContext, input: {
  readonly certificates: readonly string[]; readonly expectedVersion: number;
}): Promise<IdentityConfig> {
  const principal = await operator(services.context, request);
  const result = await services.context.uow.run(async (tx) => {
    await tx.lock("quire:accounts");
    await activeOperator(services.context, tx, principal);
    const current = await services.configurations.get(tx);
    if (!current.config.saml) throw new ServiceError("SAML_UNCONFIGURED", 503, "Missing SAML configuration");
    const config = { ...current.config, version: input.expectedVersion,
      saml: { ...current.config.saml, certificates: input.certificates } };
    new FederationSaml(services.context).client(config);
    const saved = await services.configurations.save(tx, { ...current, config });
    await auditConfiguration(services.context, tx, { principal, version: saved.version });
    return saved;
  });
  await services.context.events.dispatch();
  return result;
}
export { FederationConfigurations };
