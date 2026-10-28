import { z } from "zod";
import { AdapterGrantSchema, IdSchema } from "@quire/contracts";
import type { AdapterGrant, Id, SqlExecutor, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { SecretBox } from "./secrets";
import { GrantTokensSchema } from "./contracts";
import type { GrantTokens } from "./contracts";

const rowSchema = z.object({
  id: IdSchema, provider: z.string(), owner_id: IdSchema, label: z.string(),
  state: z.string(), scopes_json: z.string(), expires_at: z.string().nullable(),
  version: z.number().int(), encrypted_secret: z.instanceof(Uint8Array).nullable(),
});
export type OwnedGrant = { readonly grant: AdapterGrant; readonly tokens: GrantTokens };
export type GrantClaim = {
  readonly id: Id; readonly grantId: Id; readonly actorId: Id; readonly version: number;
};
export class GrantStore {
  private readonly secrets: SecretBox;
  constructor(private readonly context: ModuleContext) { this.secrets = new SecretBox(context.secretKey); }
  async activeActor(actorId: Id, tx: SqlExecutor): Promise<void> {
    if (!await tx.get("SELECT id FROM users WHERE id=? AND suspended=0 AND deleted_at IS NULL", [actorId])) {
      throw new ServiceError("UNAUTHENTICATED", 401, "Active account required");
    }
  }
  async read(actorId: Id, grantId: Id, tx: SqlExecutor = this.context.db): Promise<AdapterGrant> {
    await this.activeActor(actorId, tx);
    const row = await tx.get("SELECT * FROM provider_grants WHERE id=? AND owner_id=?", [grantId, actorId]);
    if (!row) throw new ServiceError("GRANT_NOT_FOUND", 404, "Connection not found");
    return this.dto(rowSchema.parse(row));
  }
  private dto(row: z.infer<typeof rowSchema>): AdapterGrant {
    return AdapterGrantSchema.parse({
      id: row.id, provider: row.provider, ownerId: row.owner_id, label: row.label, state: row.state,
      scopes: JSON.parse(row.scopes_json), expiresAt: row.expires_at, version: row.version,
    });
  }
  async credentials(actorId: Id, grantId: Id, tx: SqlExecutor = this.context.db): Promise<OwnedGrant> {
    await this.activeActor(actorId, tx);
    const value = await tx.get("SELECT * FROM provider_grants WHERE id=? AND owner_id=?", [grantId, actorId]);
    if (!value) throw new ServiceError("GRANT_NOT_FOUND", 404, "Connection not found");
    const row = rowSchema.parse(value);
    if (row.state !== "ready" || row.encrypted_secret === null) {
      throw new ServiceError("GRANT_UNAVAILABLE", 503, "Connection is disabled or lacks credentials");
    }
    const tokens = GrantTokensSchema.parse(JSON.parse(this.secrets.open(row.encrypted_secret, `grant:${row.id}:${row.owner_id}:${row.provider}`)));
    return { grant: this.dto(row), tokens };
  }
  async list(actorId: Id, page: { readonly cursor?: string | undefined; readonly limit: number }) {
    await this.activeActor(actorId, this.context.db);
    const cursor = page.cursor === undefined ? "" : IdSchema.parse(page.cursor);
    const rows = await this.context.db.all(
      "SELECT * FROM provider_grants WHERE owner_id=? AND id>? ORDER BY id LIMIT ?", [actorId, cursor, page.limit + 1]);
    const items = rows.slice(0, page.limit).map((row) => this.dto(rowSchema.parse(row)));
    return { items, nextCursor: rows.length > page.limit ? items.at(-1)?.id ?? null : null };
  }
  async create(input: {
    readonly actorId: Id; readonly provider: string; readonly label: string; readonly tokens: GrantTokens;
  }, tx: Transaction): Promise<AdapterGrant> {
    await this.activeActor(input.actorId, tx);
    const id = IdSchema.parse(crypto.randomUUID());
    await tx.run(`INSERT INTO provider_grants(id,provider,owner_id,label,encrypted_secret,state,scopes_json,expires_at,version,created_at)
      VALUES(?,?,?,?,?,'ready',?,?,1,?)`, [id, input.provider, input.actorId, input.label,
      this.secrets.seal(JSON.stringify(input.tokens), `grant:${id}:${input.actorId}:${input.provider}`),
      JSON.stringify(input.tokens.scopes), input.tokens.expiresAt, this.context.clock.now()]);
    return { id, provider: input.provider, ownerId: input.actorId, label: input.label,
      state: "ready", scopes: input.tokens.scopes, expiresAt: input.tokens.expiresAt, version: 1 };
  }
  async claim(input: { readonly actorId: Id; readonly grantId: Id; readonly expectedVersion: number }): Promise<GrantClaim> {
    return this.context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await tx.lock(`adapter:grant:${input.grantId}`);
      const grant = await this.read(input.actorId, input.grantId, tx);
      if (grant.version !== input.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Connection changed");
      const previous = await tx.get<{ expires_at: string }>("SELECT expires_at FROM adapter_grant_claims WHERE grant_id=?", [input.grantId]);
      if (previous && previous.expires_at > this.context.clock.now()) {
        throw new ServiceError("GRANT_BUSY", 409, "Connection has an active operation");
      }
      const id = IdSchema.parse(crypto.randomUUID());
      const expires = new Date(Date.parse(this.context.clock.now()) + 150_000).toISOString();
      await tx.run(`INSERT INTO adapter_grant_claims(grant_id,claim_id,expires_at) VALUES(?,?,?)
        ON CONFLICT(grant_id) DO UPDATE SET claim_id=excluded.claim_id,expires_at=excluded.expires_at`,
      [input.grantId, id, expires]);
      return { id, grantId: input.grantId, actorId: input.actorId, version: grant.version };
    });
  }
  async assert(claim: GrantClaim, tx: Transaction): Promise<AdapterGrant> {
    const { grant } = await this.credentials(claim.actorId, claim.grantId, tx);
    const owned = await tx.get("SELECT claim_id FROM adapter_grant_claims WHERE grant_id=? AND claim_id=? AND expires_at>?",
      [claim.grantId, claim.id, this.context.clock.now()]);
    if (!owned || grant.version !== claim.version) throw new ServiceError("GRANT_FENCE_LOST", 409, "Connection changed during provider request");
    return grant;
  }
  async release(claim: GrantClaim): Promise<void> {
    await this.context.uow.run(async (tx) => {
      await tx.lock(`adapter:grant:${claim.grantId}`);
      await tx.run("DELETE FROM adapter_grant_claims WHERE grant_id=? AND claim_id=?", [claim.grantId, claim.id]);
    });
  }
  async replace(claim: GrantClaim, tokens: GrantTokens | null, verify?: (tx: Transaction) => Promise<void>): Promise<AdapterGrant> {
    return this.context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await tx.lock(`adapter:grant:${claim.grantId}`);
      const grant = await this.assert(claim, tx);
      if (verify) await verify(tx);
      const version = grant.version + 1;
      await tx.run("UPDATE provider_grants SET encrypted_secret=?,state=?,scopes_json=?,expires_at=?,version=? WHERE id=?",
        [tokens ? this.secrets.seal(JSON.stringify(tokens), `grant:${grant.id}:${grant.ownerId}:${grant.provider}`) : null,
          tokens ? "ready" : "disabled", JSON.stringify(tokens?.scopes ?? grant.scopes),
          tokens?.expiresAt ?? null, version, grant.id]);
      await this.context.events.record(tx, { topic: "policy.changed", aggregateId: grant.id,
        payload: { resourceId: grant.id, version } });
      return { ...grant, version, state: tokens ? "ready" : "disabled",
        scopes: tokens?.scopes ?? grant.scopes, expiresAt: tokens?.expiresAt ?? null };
    });
  }
}
