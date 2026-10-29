import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import { hash, secret } from "../../accounts/identity/store";
import { SecretBox } from "../shared/secrets";
import type { ExternalIdentityVerification } from "./admission";

const stateSchema = z.object({
  provider: z.string(), browser_hash: z.string(), verifier: z.instanceof(Uint8Array), nonce: z.string(),
  config_version: z.number().int(), redirect_uri: z.string(), return_to: z.string(),
  expires_at: z.string(), consumed_at: z.string().nullable(),
  user_id: IdSchema.nullable(), session_id: IdSchema.nullable(), account_version: z.number().nullable(),
});
export function returnPath(value: string, publicUrl: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") ||
    value.split("").some((character) => character.charCodeAt(0) < 32)) {
    throw new ServiceError("OAUTH_RETURN_DENIED", 400, "Return path must be a local projects or settings page");
  }
  const destination = new URL(value, publicUrl);
  if (destination.origin !== new URL(publicUrl).origin || destination.hash ||
    (!["/projects", "/settings"].some((path) => destination.pathname === path || destination.pathname.startsWith(`${path}/`))
      && value !== "/sign-up?step=start")) {
    throw new ServiceError("OAUTH_RETURN_DENIED", 400, "Return path must be a local projects or settings page");
  }
  return destination.pathname + destination.search;
}
export class IdentityStates {
  private readonly box: SecretBox;
  constructor(private readonly context: ModuleContext) { this.box = new SecretBox(context.secretKey); }
  private cookie(provider: string, value: string, age: number) {
    return `quire_identity_${provider}=${value}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(this.context.config.publicUrl).protocol === "https:" ? "; Secure" : ""}`;
  }
  async create(request: RequestContext, input: {
    readonly provider: string; readonly version: number; readonly returnTo: string;
    readonly link?: ExternalIdentityVerification["link"];
  }) {
    const state = secret();
    const digest = hash(state);
    const browser = secret();
    const verifier = secret();
    const nonce = secret();
    const redirectUri = new URL(`/api/auth/${input.provider}/callback`, this.context.config.publicUrl).href;
    const destination = returnPath(input.returnTo, this.context.config.publicUrl);
    await this.context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      if (input.link) {
        const active = await tx.get(`SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.version=? AND u.suspended=0 AND u.deleted_at IS NULL`,
        [input.link.sessionId, input.link.userId, this.context.clock.now(), input.link.expectedVersion]);
        if (!active) throw new ServiceError("VERSION_CONFLICT", 409, "Link session or account changed");
      }
      await tx.run("DELETE FROM identity_oauth_states WHERE expires_at<?", [this.context.clock.now()]);
      await tx.run(`INSERT INTO identity_oauth_states
        (digest,provider,browser_hash,verifier,nonce,config_version,redirect_uri,return_to,expires_at,user_id,session_id,account_version)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [digest, input.provider, hash(browser),
        this.box.seal(verifier, `identity-state:${digest}`), nonce, input.version, redirectUri, destination,
        new Date(Date.parse(this.context.clock.now()) + 10 * 60_000).toISOString(),
        input.link?.userId ?? null, input.link?.sessionId ?? null, input.link?.expectedVersion ?? null]);
    });
    request.responseHeaders.append("set-cookie", this.cookie(input.provider, browser, 600));
    return { state, verifier, nonce, redirectUri };
  }
  async consume(request: RequestContext, input: { readonly provider: string; readonly state: string; readonly version: number }) {
    const cookies = (request.request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
      .filter((part) => part.startsWith(`quire_identity_${input.provider}=`));
    const browser = cookies.length === 1 ? cookies[0]?.split("=")[1] : undefined;
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.state) || !browser) {
      throw new ServiceError("OAUTH_STATE_INVALID", 400, "State and initiating browser cookie required");
    }
    const digest = hash(input.state);
    const state = await this.context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      const raw = await tx.get("SELECT * FROM identity_oauth_states WHERE digest=?", [digest]);
      if (!raw) throw new ServiceError("OAUTH_STATE_INVALID", 400, "Unknown authorization state");
      const row = stateSchema.parse(raw);
      if (row.provider !== input.provider || row.browser_hash !== hash(browser) ||
        row.config_version !== input.version || row.consumed_at !== null || row.expires_at <= this.context.clock.now()) {
        throw new ServiceError("OAUTH_STATE_INVALID", 400, "State expired, replayed, or does not match browser/provider/configuration");
      }
      await tx.run("UPDATE identity_oauth_states SET consumed_at=? WHERE digest=?", [this.context.clock.now(), digest]);
      return row;
    });
    request.responseHeaders.append("set-cookie", this.cookie(input.provider, "", 0));
    return { ...state, verifier: this.box.open(state.verifier, `identity-state:${digest}`) };
  }
}
