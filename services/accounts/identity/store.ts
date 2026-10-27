import { z } from "zod";
import { createHmac } from "node:crypto";
import { IdSchema, UserSchema, PreferencesSchema } from "@quire/contracts";
import type { Id, Preferences } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";

export const userRow = z.object({
  id: IdSchema, name: z.string(), primary_email: z.string(), password_hash: z.string().nullable(),
  latex_name: z.string(), affiliation: z.string(), orcid: z.string().nullable(),
  interface_language: z.string(), avatar_blob: z.string().nullable(), managed_by: z.string().nullable(),
  operator: z.number(), suspended: z.number(), deleted_at: z.string().nullable(), version: z.number(),
});
export const defaultPreferences: Preferences = PreferencesSchema.parse({
  theme: "system", bindings: "default", fontSize: 13, fontFamily: "plex", lineHeight: "normal",
  defaultView: "split", defaultEngine: "pdflatex", dictionary: "en-US", spellCheck: true,
  customWords: [], viewer: "builtin", autoCompile: false, autocomplete: true, autoClose: true,
  cursors: true, aiModel: null, aiMode: "ask", aiStyle: "match", citationProviders: [],
  inlineCompletion: false, errorAssist: false, citationWebSearch: false, aiBranch: false,
  shareAiChat: false, compileBeforeCommit: false, version: 0,
});
export const newId = () => IdSchema.parse(crypto.randomUUID());
export const hash = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
export const secret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
export const hashPassword = (password: string) =>
  Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
const mailKinds = {
  reset: { minutes: 30, path: "/reset-password", subject: "Reset your Quire password" },
  verify: { minutes: 1440, path: "/verify-email", subject: "Verify your Quire email" },
} as const;

export function store(context: ModuleContext) {
  const { db, clock } = context;
  function find(id: Id) {
    const row = db.query("SELECT * FROM users WHERE id=? AND deleted_at IS NULL AND suspended=0").get(id);
    if (!row) throw new ServiceError("UNAUTHENTICATED", 401, "Authentication required");
    return userRow.parse(row);
  }
  function user(id: Id) {
    const row = find(id);
    const emails = z.array(z.object({ email: z.string() })).parse(
      db.query("SELECT email FROM verified_emails WHERE user_id=? ORDER BY email").all(id));
    return UserSchema.parse({
      id: row.id, name: row.name, primaryEmail: row.primary_email,
      verifiedEmails: emails.map((entry) => entry.email), managedBy: row.managed_by,
      avatarBlob: row.avatar_blob, latexName: row.latex_name, affiliation: row.affiliation,
      orcid: row.orcid, interfaceLanguage: row.interface_language,
    });
  }
  function preferences(id: Id) {
    const row = z.object({ value_json: z.string(), version: z.number() }).parse(
      db.query("SELECT value_json,version FROM preferences WHERE user_id=?").get(id));
    return PreferencesSchema.parse({ ...PreferencesSchema.parse(JSON.parse(row.value_json)), version: row.version });
  }
  function version(id: Id, expected: number) {
    if (db.query("UPDATE users SET version=version+1,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL")
      .run(clock.now(), id, expected).changes !== 1) {
      throw new ServiceError("VERSION_CONFLICT", 409, "Account changed; fetch /me and retry");
    }
    return expected + 1;
  }
  function mail(input: { readonly userId: Id; readonly email: string; readonly purpose: "verify" | "reset" }) {
    const credential = secret();
    const id = newId();
    const now = clock.now();
    const delivery = mailKinds[input.purpose];
    const expires = new Date(Date.parse(now) + delivery.minutes * 60_000).toISOString();
    db.query("UPDATE one_time_tokens SET used_at=? WHERE user_id=? AND purpose=? AND used_at IS NULL AND json_extract(payload_json,'$.email')=?")
      .run(now, input.userId, input.purpose, input.email);
    db.query("INSERT INTO one_time_tokens(id,user_id,token_hash,purpose,payload_json,expires_at,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, input.userId, hash(credential), input.purpose, JSON.stringify({ email: input.email }), expires, now);
    const url = new URL(delivery.path, context.config.publicUrl);
    url.searchParams.set("token", credential);
    db.query("INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,status,created_at) VALUES(?,?,?,?,?,'local',?)")
      .run(newId(), input.email, delivery.subject,
        `${url.href}\nExpires: ${expires}\nThis link does not sign you in.`, `identity:${id}`, now);
  }
  function token(raw: string, purpose: "verify" | "reset") {
    const value = db.query("SELECT id,user_id,payload_json FROM one_time_tokens WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?")
      .get(hash(raw), purpose, clock.now());
    if (!value) throw new ServiceError("INVALID_TOKEN", 400, "Token is invalid or expired");
    return z.object({ id: IdSchema, user_id: IdSchema, payload_json: z.string() }).parse(value);
  }
  function consume(id: Id) {
    if (db.query("UPDATE one_time_tokens SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?")
      .run(clock.now(), id, clock.now()).changes !== 1) {
      throw new ServiceError("INVALID_TOKEN", 400, "Token is invalid or expired");
    }
  }
  function limit(category: string, subject: string) {
    // Persisted buckets prevent restarts from resetting login and mail abuse limits.
    const key = createHmac("sha256", context.secretKey).update(JSON.stringify([category, subject])).digest("hex");
    const bucket = Math.floor(Date.parse(clock.now()) / 900_000);
    db.query("DELETE FROM identity_rate_limits WHERE bucket<?").run(bucket - 1);
    db.query("INSERT INTO identity_rate_limits(key,bucket,attempts) VALUES(?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET attempts=attempts+1")
      .run(key, bucket);
    const row = z.object({ attempts: z.number() }).parse(
      db.query("SELECT attempts FROM identity_rate_limits WHERE key=? AND bucket=?").get(key, bucket));
    if (row.attempts > 30) throw new ServiceError("RATE_LIMITED", 429, "Try again later");
  }
  function idempotent<T extends z.ZodType>(input: {
    readonly actor: string; readonly route: string; readonly key: string;
    readonly body: unknown; readonly schema: T;
  }, action: () => z.output<T>): z.output<T> {
    const digest = createHmac("sha256", context.secretKey).update(JSON.stringify(input.body)).digest("hex");
    const value = db.query("SELECT digest,response_json FROM identity_requests WHERE actor=? AND route=? AND key=?")
      .get(input.actor, input.route, input.key);
    if (value) {
      const row = z.object({ digest: z.string(), response_json: z.string() }).parse(value);
      if (row.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Key was used for different input");
      return input.schema.parse(JSON.parse(row.response_json));
    }
    const result = input.schema.parse(action());
    db.query("INSERT INTO identity_requests(actor,route,key,digest,response_json) VALUES(?,?,?,?,?)")
      .run(input.actor, input.route, input.key, digest, JSON.stringify(result));
    return result;
  }
  return { find, user, preferences, version, mail, token, consume, limit, idempotent };
}
export type IdentityStore = ReturnType<typeof store>;
