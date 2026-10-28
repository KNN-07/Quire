import { z } from "zod";
import { IdSchema, InstantSchema, endpoints } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { actor, etag, replay } from "../base/http";
import { fail, newId, compare } from "../base/store";

export const credentialHash = (secret: string) => new Bun.CryptoHasher("sha256").update(secret).digest("hex");
export function tokenDigest(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  let secret = "";
  if (authorization.startsWith("Bearer ")) secret = authorization.slice(7);
  if (authorization.startsWith("Basic ")) {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    if (decoded.startsWith("git:")) secret = decoded.slice(4);
  }
  if (!secret) fail("GIT_AUTH_REQUIRED", 401, "Current Git token required");
  return credentialHash(secret);
}
export async function tokenActor(context: Pick<ModuleContext, "db" | "clock">, request: Request): Promise<Id> {
  const row = await context.db.get<{ user_id: string }>(`SELECT t.user_id FROM git_tokens t
    JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>?
    AND u.suspended=0 AND u.deleted_at IS NULL`, [tokenDigest(request), context.clock.now()]);
  if (!row) fail("GIT_AUTH_REQUIRED", 401, "Current Git token required");
  return IdSchema.parse(row.user_id);
}
export async function sshFingerprint(publicKey: string): Promise<string> {
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/]+={0,2}(?: [^\r\n]*)?$/.test(publicKey)) {
    fail("INVALID_SSH_KEY", 422, "Expected an ordinary OpenSSH public key without authorization options");
  }
  const child = Bun.spawn(["ssh-keygen", "-lf", "/dev/stdin", "-E", "sha256"], {
    stdin: new Blob([`${publicKey}\n`]), stdout: "pipe", stderr: "pipe",
  });
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) fail("INVALID_SSH_KEY", 422, error.trim());
  const fingerprint = out.split(" ")[1];
  if (!fingerprint?.startsWith("SHA256:")) fail("INVALID_SSH_KEY", 422, "Key fingerprint missing");
  return fingerprint;
}
/** SSH transport owners must also authorize each requested project action. */
export async function sshActor(context: Pick<ModuleContext, "db">, fingerprint: string): Promise<Id | null> {
  const row = await context.db.get<{ user_id: string }>(`SELECT k.user_id FROM ssh_keys k
    JOIN users u ON u.id=k.user_id WHERE k.fingerprint=? AND u.suspended=0 AND u.deleted_at IS NULL`, [fingerprint]);
  return row ? IdSchema.parse(row.user_id) : null;
}
const keyRow = z.object({ id: IdSchema, name: z.string(), publicKey: z.string(), version: z.number() });
async function key(context: Pick<ModuleContext, "db">, actorId: Id, id: Id) {
  const row = await context.db.get('SELECT id,name,public_key AS "publicKey",version FROM ssh_keys WHERE id=? AND user_id=?', [id, actorId]);
  if (!row) fail("NOT_FOUND", 404, "Key not found");
  return keyRow.parse(row);
}
export function registerCredentials(context: ModuleContext) {
  context.routes.register(endpoints.gitTokensList, async (input, request) => {
    const actorId = await actor(context, request);
    const rows = await context.db.all(`SELECT id,name,expires_at AS "expiresAt",created_at AS "createdAt",version
      FROM git_tokens WHERE user_id=? AND id>? ORDER BY id LIMIT ?`, [actorId, input.query.cursor ?? "", input.query.limit + 1]);
    const items = z.array(z.object({ id: IdSchema, name: z.string(), expiresAt: InstantSchema, createdAt: InstantSchema, version: z.number() })).parse(rows);
    const page = items.slice(0, input.query.limit);
    return { items: page, nextCursor: items.length > input.query.limit ? page.at(-1)?.id ?? null : null };
  });
  context.routes.register(endpoints.gitTokenCreate, async (input, request) => {
    const actorId = await actor(context, request);
    if (input.body.expiresAt <= context.clock.now()) fail("INVALID_EXPIRY", 422, "Expiry must be in the future");
    const maximum = new Date(context.clock.now());
    maximum.setUTCFullYear(maximum.getUTCFullYear() + 1);
    if (Date.parse(input.body.expiresAt) > maximum.getTime()) fail("INVALID_EXPIRY", 422, "Git tokens expire within one year");
    const id = newId();
    const secret = `quire_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
    const tokenHash = credentialHash(secret);
    // The replay receipt deliberately contains no bearer secret.
    const created = await replay(context, { actorId, request, route: "gitTokenCreate", body: input,
      schema: endpoints.gitTokenCreate.output }, async () => {
      await context.uow.run(async tx => {
        await tx.lock("quire:accounts");
        const count = z.object({ count: z.number() }).parse(await tx.get(
          "SELECT count(*) AS count FROM git_tokens WHERE user_id=?", [actorId])).count;
        if (count >= 10) fail("TOKEN_LIMIT", 409, "At most ten Git tokens may be stored");
        await tx.run("INSERT INTO git_tokens(id,user_id,name,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)",
          [id, actorId, input.body.name, tokenHash, input.body.expiresAt, context.clock.now()]);
      });
      return { id, secretOnce: "" };
    });
    return { id: created.id, secretOnce: created.id === id ? secret : "" };
  });
  context.routes.register(endpoints.gitTokenDelete, async (input, request) => {
    const actorId = await actor(context, request);
    await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const row = await tx.get<{ version: number }>("SELECT version FROM git_tokens WHERE id=? AND user_id=?", [input.params.id, actorId]);
      if (!row) fail("NOT_FOUND", 404, "Token not found");
      compare(row.version, input.body.expectedVersion);
      await tx.run("DELETE FROM git_tokens WHERE id=? AND user_id=?", [input.params.id, actorId]);
    });
    return { ok: true as const, version: input.body.expectedVersion + 1 };
  });
  context.routes.register(endpoints.sshKeysList, async (input, request) => {
    const actorId = await actor(context, request);
    const rows = z.array(keyRow).parse(await context.db.all(`SELECT id,name,public_key AS "publicKey",version
      FROM ssh_keys WHERE user_id=? AND id>? ORDER BY id LIMIT ?`, [actorId, input.query.cursor ?? "", input.query.limit + 1]));
    const items = rows.slice(0, input.query.limit);
    return { items, nextCursor: rows.length > input.query.limit ? items.at(-1)?.id ?? null : null };
  });
  context.routes.register(endpoints.sshKeyGet, async (input, request) => {
    const result = await key(context, await actor(context, request), input.params.id);
    etag(request, result.version);
    return result;
  });
  context.routes.register(endpoints.sshKeyCreate, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: "sshKeyCreate", body: input, schema: endpoints.sshKeyCreate.output }, async () => {
      const fingerprint = await sshFingerprint(input.body.publicKey);
      const id = newId();
      await context.uow.run(async tx => {
        await tx.lock("quire:accounts");
        if (await tx.get("SELECT 1 FROM ssh_keys WHERE fingerprint=?", [fingerprint])) fail("KEY_EXISTS", 409, "Key already registered");
        await tx.run("INSERT INTO ssh_keys(id,user_id,name,public_key,fingerprint,created_at) VALUES(?,?,?,?,?,?)",
          [id, actorId, input.body.name, input.body.publicKey, fingerprint, context.clock.now()]);
      });
      etag(request, 0);
      return key(context, actorId, id);
    });
  });
  context.routes.register(endpoints.sshKeyPatch, async (input, request) => {
    const actorId = await actor(context, request);
    const current = await key(context, actorId, input.params.id);
    const publicKey = input.body.publicKey ?? current.publicKey;
    const fingerprint = await sshFingerprint(publicKey);
    await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      compare((await key({ db: tx }, actorId, current.id)).version, input.body.expectedVersion);
      if (await tx.get("SELECT 1 FROM ssh_keys WHERE fingerprint=? AND id<>?", [fingerprint, current.id])) fail("KEY_EXISTS", 409, "Key already registered");
      await tx.run("UPDATE ssh_keys SET name=?,public_key=?,fingerprint=?,version=version+1 WHERE id=?",
        [input.body.name ?? current.name, publicKey, fingerprint, current.id]);
    });
    etag(request, current.version + 1);
    return { ...current, name: input.body.name ?? current.name, publicKey, version: current.version + 1 };
  });
  context.routes.register(endpoints.sshKeyDelete, async (input, request) => {
    const actorId = await actor(context, request);
    await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      compare((await key({ db: tx }, actorId, input.params.id)).version, input.body.expectedVersion);
      await tx.run("DELETE FROM ssh_keys WHERE id=? AND user_id=?", [input.params.id, actorId]);
    });
    return { ok: true as const, version: input.body.expectedVersion + 1 };
  });
}
