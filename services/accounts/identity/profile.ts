import { endpoints, OkSchema, PreferencesSchema, UserSchema, resourceVersionTag } from "@quire/contracts";
import { referenceBlob, ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import type { IdentityDependencies } from "./credentials";

export function registerProfile(context: ModuleContext, dependencies: IdentityDependencies): void {
  const { routes, uow, clock } = context;
  const { repository, auth } = dependencies;
  routes.register(endpoints.avatarGet, async (_input, request) => {
    request.responseHeaders.set("cache-control", "private, no-store");
    const principal = await auth.port.require(request.request);
    const digest = principal.user.avatarBlob;
    if (!digest) throw new ServiceError("NOT_FOUND", 404, "Avatar not found");
    const bytes = await context.blobs.get(digest);
    const png = bytes[0] === 137;
    request.responseHeaders.set("content-type", png ? "image/png" : "image/jpeg");
    request.responseHeaders.set("content-disposition", `inline; filename="avatar.${png ? "png" : "jpg"}"`);
    request.responseHeaders.set("etag", `"${digest}"`);
    request.responseHeaders.set("x-content-type-options", "nosniff");
    return new Uint8Array(bytes);
  });
  routes.register(endpoints.profilePatch, async ({ body }, request) => {
    const principal = await auth.mutation(request.request);
    const { expectedVersion, ...patch } = body;
    const current = UserSchema.parse({ ...principal.user, ...patch });
    await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      const version = await repository.version(tx, current.id, expectedVersion);
      await tx.run("UPDATE users SET name=?,latex_name=?,affiliation=?,orcid=?,interface_language=? WHERE id=?", [current.name, current.latexName, current.affiliation, current.orcid, current.interfaceLanguage, current.id]);
      request.responseHeaders.set("etag", resourceVersionTag(version));
    });
    return (await repository.user(current.id));
  });
  routes.register(endpoints.preferencesGet, async (_input, request) => {
    const principal = await auth.port.require(request.request);
    const value = (await repository.preferences(principal.user.id));
    request.responseHeaders.set("etag", resourceVersionTag(value.version));
    return value;
  });
  routes.register(endpoints.preferencesPatch, async ({ body }, request) => {
    const principal = await auth.mutation(request.request);
    const { expectedVersion, ...patch } = body;
    return await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      const value = PreferencesSchema.parse({ ...await repository.preferences(principal.user.id, tx), ...patch, version: expectedVersion + 1 });
      if ((await tx.run("UPDATE preferences SET value_json=?,version=version+1,updated_at=? WHERE user_id=? AND version=?", [JSON.stringify(value), clock.now(), principal.user.id, expectedVersion])).changes !== 1) {
        throw new ServiceError("VERSION_CONFLICT", 409, "Preferences changed; fetch and retry");
      }
      request.responseHeaders.set("etag", resourceVersionTag(value.version));
      return value;
    });
  });
  routes.register(endpoints.avatarPut, async ({ body, headers }, request) => {
    const principal = await auth.mutation(request.request);
    if (headers?.["if-match"] !== resourceVersionTag(body.expectedVersion)) {
      throw new ServiceError("VERSION_CONFLICT", 409, "If-Match disagrees with expectedVersion");
    }
    if (body.file.size > 2 * 1024 * 1024) throw new ServiceError("AVATAR_TOO_LARGE", 413, "Avatar maximum is 2 MiB");
    const bytes = new Uint8Array(await body.file.arrayBuffer());
    const png = bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!(png && body.file.type === "image/png") && !(jpeg && body.file.type === "image/jpeg")) {
      throw new ServiceError("INVALID_AVATAR", 422, "Avatar must be PNG or JPEG");
    }
    const digest = await context.blobs.put(bytes);
    await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      const version = await repository.version(tx, principal.user.id, body.expectedVersion);
      await referenceBlob(tx, { digest, bytes: bytes.length }, clock);
      await tx.run("UPDATE users SET avatar_blob=? WHERE id=?", [digest, principal.user.id]);
      request.responseHeaders.set("etag", resourceVersionTag(version));
    });
    return (await repository.user(principal.user.id));
  });
  routes.register(endpoints.avatarDelete, async ({ body }, request) => {
    const principal = await auth.mutation(request.request);
    return await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      const version = await repository.version(tx, principal.user.id, body.expectedVersion);
      await tx.run("UPDATE users SET avatar_blob=NULL WHERE id=?", [principal.user.id]);
      request.responseHeaders.set("etag", resourceVersionTag(version));
      return { ok: true as const, version };
    });
  });
  routes.register(endpoints.emailAdd, async ({ body }, request) => {
    const principal = await auth.mutation(request.request);
    const email = body.email.toLowerCase();
    await repository.limit("email-add", principal.user.id);
    const result = await uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      return await repository.idempotent(tx, {
        actor: principal.user.id, route: "emailAdd", key: request.request.headers.get("idempotency-key") ?? "",
        body, schema: OkSchema,
      }, async () => {
        const row = await repository.find(principal.user.id, tx);
        if (row.managed_by !== null) throw new ServiceError("MANAGED_ACCOUNT", 403, "Managed email changes require organization administration");
        if ((await tx.get("SELECT id FROM users WHERE lower(primary_email)=lower(?) UNION SELECT user_id FROM verified_emails WHERE lower(email)=lower(?)", [email, email]))) {
          throw new ServiceError("EMAIL_UNAVAILABLE", 409, "Email is unavailable");
        }
        const version = await repository.version(tx, principal.user.id, body.expectedVersion);
        await repository.mail(tx, { userId: principal.user.id, email, purpose: "verify" });
        request.responseHeaders.set("etag", resourceVersionTag(version));
        return { ok: true as const, version };
      });
    });
    request.responseHeaders.set("etag", resourceVersionTag(result.version));
    return result;
  });
  routes.register(endpoints.emailDelete, async ({ body }, request) => {
    const principal = await auth.mutation(request.request);
    return await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      const row = await repository.find(principal.user.id, tx);
      if (row.managed_by !== null) throw new ServiceError("MANAGED_ACCOUNT", 403, "Managed email changes require organization administration");
      const email = body.email.toLowerCase();
      const value = (await tx.get("SELECT id FROM verified_emails WHERE lower(email)=lower(?) AND user_id=?", [email, principal.user.id]));
      if (!value) throw new ServiceError("NOT_FOUND", 404, "Email not found");
      if (email === row.primary_email.toLowerCase()) throw new ServiceError("PRIMARY_EMAIL_REQUIRED", 409, "Primary login email cannot be removed");
      const version = await repository.version(tx, principal.user.id, body.expectedVersion);
      await tx.run("DELETE FROM verified_emails WHERE lower(email)=lower(?) AND user_id=?", [email, principal.user.id]);
      await tx.run(tx.dialect === "postgres" ? "UPDATE one_time_tokens SET used_at=? WHERE user_id=? AND purpose='verify' AND lower(payload_json::jsonb->>'email')=lower(?)" : "UPDATE one_time_tokens SET used_at=? WHERE user_id=? AND purpose='verify' AND lower(json_extract(payload_json,'$.email'))=lower(?)", [clock.now(), principal.user.id, email]);
      request.responseHeaders.set("etag", resourceVersionTag(version));
      return { ok: true, version };
    });
  });
  routes.register(endpoints.aiConsent, async ({ body }, request) => {
    const principal = await auth.mutation(request.request);
    if (!body.termsVersion.trim()) throw new ServiceError("TERMS_REQUIRED", 400, "Terms version required");
    const result = await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      const version = await repository.version(tx, principal.user.id, body.expectedVersion);
      await tx.run("INSERT INTO identity_ai_consent(user_id,terms_version,accepted,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET terms_version=excluded.terms_version,accepted=excluded.accepted,updated_at=excluded.updated_at", [principal.user.id, body.termsVersion, Number(body.accepted), clock.now()]);
      await context.events.record(tx, { topic: "policy.changed", aggregateId: principal.user.id,
        payload: { resourceId: principal.user.id, version } });
      request.responseHeaders.set("etag", resourceVersionTag(version));
      return { ok: true as const, version };
    });
    await context.events.dispatch();
    return result;
  });
}
