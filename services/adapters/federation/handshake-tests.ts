import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { IdSchema, IdentityConfigSchema, OperationSchema } from "@quire/contracts";
import type { Id, Operation, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { Principal, RequestContext } from "@quire/runtime";
import { hash, newId } from "../../accounts/identity/store";
import { SecretBox } from "../shared/secrets";
import { IdentityStates } from "../identity/state";
import type { IdentityProvider } from "../identity";
import { FederationOidc, redirect } from "./oidc";
import type { FederationServices } from "./oidc";
import { FederationSaml } from "./saml";
import { FederationLdap } from "./ldap";
import { activeOperator } from "./admin";

const testRow = z.object({
  id: IdSchema, actor_id: IdSchema, session_id: IdSchema, config_json: z.string(),
  oidc_secret: z.instanceof(Uint8Array).nullable(), ldap_secret: z.instanceof(Uint8Array).nullable(),
  expires_at: z.string(), nonce_hash: z.string(), request_digest: z.string(),
});
export type DraftTest = {
  readonly draftConfig: z.infer<typeof IdentityConfigSchema>; readonly nonce: string;
  readonly oidcSecret?: string | undefined; readonly ldapSecret?: string | undefined;
  readonly ldapUsername?: string | undefined; readonly ldapPassword?: string | undefined;
};
export class FederationHandshakeTests {
  private readonly states: IdentityStates;
  private readonly box: SecretBox;
  constructor(private readonly services: FederationServices) {
    this.states = new IdentityStates(services.context);
    this.box = new SecretBox(services.context.secretKey);
  }
  async start(request: RequestContext, principal: Principal, input: DraftTest): Promise<Operation> {
    const { context, configurations, http } = this.services;
    await context.uow.run(async (tx) => {
      await tx.run(`UPDATE operations SET status='failed',error_code='TEST_EXPIRED',updated_at=?
        WHERE status='running' AND id IN (SELECT id FROM federation_tests WHERE expires_at<=?)`, [context.clock.now(), context.clock.now()]);
      await tx.run("UPDATE federation_tests SET oidc_secret=NULL,ldap_secret=NULL WHERE expires_at<=?", [context.clock.now()]);
    });
    const key = request.request.headers.get("idempotency-key") ?? "";
    const digest = createHmac("sha256", context.secretKey).update(JSON.stringify(input)).digest("hex");
    const previous = await context.db.get("SELECT o.id,t.request_digest FROM operations o JOIN federation_tests t ON t.id=o.id WHERE o.actor_id=? AND o.idempotency_key=?", [principal.user.id, `federation-test:${key}`]);
    if (previous) {
      const row = z.object({ id: IdSchema, request_digest: z.string() }).parse(previous);
      if (row.request_digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Test key reused with different input");
      return this.operation(row.id);
    }
    const current = await configurations.get();
    const settings = { config: input.draftConfig, oidcSecret: input.oidcSecret ?? current.oidcSecret, ldapSecret: input.ldapSecret ?? current.ldapSecret };
    if (!configurations.capability(settings).enabled) throw new ServiceError("FEDERATION_UNCONFIGURED", 503, configurations.capability(settings).reason ?? "Draft disabled");
    const id = newId();
    const state = await this.states.create(request, { provider: "federation-test", version: settings.config.version, returnTo: "/settings/identities" });
    let authorizationUrl: string | null = null;
    let ldapProof: { readonly subject: string } | null = null;
    switch (settings.config.protocol) {
      case "oidc": {
        const { discovery, config } = await new FederationOidc(http, context).discover(settings);
        const url = new URL(discovery.authorization_endpoint);
        url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", scope: config.scopes.join(" "),
          redirect_uri: state.redirectUri, state: state.state, nonce: state.nonce, code_challenge_method: "S256",
          code_challenge: createHash("sha256").update(state.verifier).digest("base64url") }).toString();
        authorizationUrl = url.href;
        break;
      }
      case "saml":
        await http.validate(settings.config.saml?.ssoUrl ?? "", true);
        authorizationUrl = await new FederationSaml(context).client(settings.config).getAuthorizeUrlAsync(state.state, undefined, {});
        if (new URL(context.config.publicUrl).protocol === "https:") {
          const cookies = request.responseHeaders.getSetCookie();
          request.responseHeaders.delete("set-cookie");
          for (const cookie of cookies) request.responseHeaders.append("set-cookie", cookie.replace("SameSite=Lax", "SameSite=None"));
        }
        break;
      case "ldap":
        if (!input.ldapUsername || !input.ldapPassword) throw new ServiceError("LDAP_TEST_CREDENTIALS_REQUIRED", 400, "Supply ldapUsername and ldapPassword for a real user bind");
        ldapProof = await new FederationLdap(configurations.deployment).verify(settings, { username: input.ldapUsername, password: input.ldapPassword });
        break;
      default: {
        const unreachable: never = settings.config.protocol;
        throw new ServiceError("PROTOCOL_INVALID", 400, String(unreachable));
      }
    }
    await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await activeOperator(context, tx, principal);
      const result = { operatorOnly: true, authorizationUrl, nonceHash: hash(input.nonce), verified: ldapProof !== null };
      await tx.run("INSERT INTO operations(id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
        [id, principal.user.id, "federation.test", ldapProof ? "succeeded" : "running", ldapProof ? 1 : 0,
          JSON.stringify(result), `federation-test:${key}`, context.clock.now(), context.clock.now()]);
      await tx.run(`INSERT INTO federation_tests(id,config_json,oidc_secret,ldap_secret,nonce_hash,actor_id,session_id,expires_at,state_digest,request_digest)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, [id, JSON.stringify(settings.config),
        settings.oidcSecret && !ldapProof ? this.box.seal(settings.oidcSecret, `test:${id}:oidc`) : null,
        settings.ldapSecret && !ldapProof ? this.box.seal(settings.ldapSecret, `test:${id}:ldap`) : null,
        hash(input.nonce), principal.user.id, principal.sessionId, new Date(Date.parse(context.clock.now()) + 600_000).toISOString(),
        hash(state.state), digest]);
      await context.events.record(tx, { topic: "operation.changed", aggregateId: id, payload: { resourceId: id, status: ldapProof ? "succeeded" : "running" } });
    });
    await context.events.dispatch();
    return this.operation(id);
  }
  async operation(id: Id) {
    const row = z.object({ status: z.string(), progress: z.number(), result_json: z.string().nullable(), error_code: z.string().nullable() })
      .parse(await this.services.context.db.get("SELECT status,progress,result_json,error_code FROM operations WHERE id=?", [id]));
    return OperationSchema.parse({ id, kind: "federation.test", status: row.status, progress: row.progress,
      result: row.result_json ? JSON.parse(row.result_json) : null, errorCode: row.error_code });
  }
  async owns(state: string) {
    return Boolean(await this.services.context.db.get("SELECT id FROM federation_tests WHERE state_digest=?", [hash(state)]));
  }
  async complete(request: RequestContext, proof: { readonly state: string; readonly code?: string; readonly samlResponse?: string }) {
    const { context, http } = this.services;
    const row = testRow.parse(await context.db.get("SELECT * FROM federation_tests WHERE state_digest=?", [hash(proof.state)]));
    const config = IdentityConfigSchema.parse(JSON.parse(row.config_json));
    const state = await this.states.consume(request, { provider: "federation-test", state: proof.state, version: config.version });
    const settings = { config, oidcSecret: row.oidc_secret ? this.box.open(row.oidc_secret, `test:${row.id}:oidc`) : null,
      ldapSecret: row.ldap_secret ? this.box.open(row.ldap_secret, `test:${row.id}:ldap`) : null };
    let publish: ((tx: Transaction) => Promise<void>) | undefined;
    try {
      switch (config.protocol) {
        case "oidc":
          if (!proof.code) throw new ServiceError("OIDC_CODE_REQUIRED", 400, "Test authorization code required");
          await new FederationOidc(http, context).verify(settings, { code: proof.code, verifier: state.verifier, nonce: state.nonce, redirectUri: state.redirect_uri });
          break;
        case "saml":
          if (!proof.samlResponse) throw new ServiceError("SAML_RESPONSE_REQUIRED", 400, "Signed test response required");
          publish = (await new FederationSaml(context).verify(config, proof.samlResponse)).publish;
          break;
        case "ldap": throw new ServiceError("TEST_PROTOCOL_INVALID", 400, "LDAP tests finish during the bind request");
        default: {
          const unreachable: never = config.protocol;
          throw new ServiceError("PROTOCOL_INVALID", 400, String(unreachable));
        }
      }
      await context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        if (row.expires_at <= context.clock.now() || !await tx.get(`SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.operator=1 AND u.suspended=0 AND u.deleted_at IS NULL`, [row.session_id, row.actor_id, context.clock.now()])) {
          throw new ServiceError("TEST_SESSION_EXPIRED", 403, "Initiating operator session expired or was revoked");
        }
        await publish?.(tx);
        await tx.run("UPDATE operations SET status='succeeded',progress=1,result_json=?,updated_at=? WHERE id=? AND status='running'",
          [JSON.stringify({ operatorOnly: true, verified: true, nonceHash: row.nonce_hash }), context.clock.now(), row.id]);
        await tx.run("UPDATE federation_tests SET oidc_secret=NULL,ldap_secret=NULL WHERE id=?", [row.id]);
        await context.events.record(tx, { topic: "operation.changed", aggregateId: row.id, payload: { resourceId: row.id, status: "succeeded" } });
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      await context.uow.run(async (tx) => {
        await tx.run("UPDATE operations SET status='failed',error_code=?,updated_at=? WHERE id=? AND status='running'",
          [error instanceof ServiceError ? error.code : "FEDERATION_TEST_FAILED", context.clock.now(), row.id]);
        await tx.run("UPDATE federation_tests SET oidc_secret=NULL,ldap_secret=NULL WHERE id=?", [row.id]);
        await context.events.record(tx, { topic: "operation.changed", aggregateId: row.id, payload: { resourceId: row.id, status: "failed" } });
      });
      await context.events.dispatch();
      throw error;
    }
    await context.events.dispatch();
    return redirect(request, state.return_to);
  }
  provider(): IdentityProvider {
    return { id: "federation-test", label: "Operator federation test",
      read: () => ({ enabled: false, state: "disabled", reason: "Start tests from identity administration" }),
      start: async () => { throw new ServiceError("TEST_START_REQUIRED", 403, "Use authenticated identity test endpoint"); },
      link: async () => { throw new ServiceError("TEST_LINK_DENIED", 403, "Tests never link accounts"); },
      callback: async (request) => {
        const query = new URL(request.request.url).searchParams;
        return this.complete(request, { state: query.get("state") ?? "", code: query.get("code") ?? "" });
      } };
  }
}
