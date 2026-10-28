import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { ServiceError } from "@quire/runtime";

const authorizationSchema = z.object({
  response_type: z.literal("code"), client_id: z.literal("fixture-client"),
  redirect_uri: z.url(), scope: z.literal("read write"), state: z.string().min(43),
  code_challenge_method: z.literal("S256"), code_challenge: z.string().length(43),
});
const tokenSchema = z.discriminatedUnion("grant_type", [
  z.object({ grant_type: z.literal("authorization_code"), code: z.string(), redirect_uri: z.url(), code_verifier: z.string().min(43) }),
  z.object({ grant_type: z.literal("refresh_token"), refresh_token: z.string() }),
]);
const actionSchema = z.strictObject({ value: z.string(), cursor: z.string().nullable() });
type Token = { readonly access: string; readonly refresh: string; readonly generation: number; readonly expiresAt: number };
type Authorization = z.infer<typeof authorizationSchema>;
export function providerServer() {
  const codes = new Map<string, Authorization>();
  const tokens = new Map<string, Token>();
  const refresh = new Map<string, Token>();
  const receipts = new Map<string, { readonly body: string; readonly result: { readonly value: string; readonly cursor: string } }>();
  const observed: string[] = [];
  let cursor: string | null = null;
  let count = 0;
  let tokenCalls = 0;
  let revocations = 0;
  let now = 0;
  let gate: { readonly entered: ReturnType<typeof Promise.withResolvers<void>>; readonly release: ReturnType<typeof Promise.withResolvers<void>> } | null = null;
  const issue = (generation: number) => {
    const token: Token = { access: randomBytes(32).toString("base64url"),
      refresh: randomBytes(32).toString("base64url"), generation, expiresAt: now + 60_000 };
    tokens.set(token.access, token); refresh.set(token.refresh, token);
    return Response.json({ access_token: token.access, refresh_token: token.refresh, token_type: "Bearer",
      expires_in: 60, scope: "read write" });
  };
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      observed.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/authorize") {
        const parsed = authorizationSchema.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success || parsed.data.redirect_uri !== "http://localhost:5173/api/connections/fixture/callback") {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }
        const code = randomBytes(24).toString("base64url");
        codes.set(code, parsed.data);
        const target = new URL(parsed.data.redirect_uri);
        target.searchParams.set("code", code); target.searchParams.set("state", parsed.data.state);
        return Response.redirect(target, 303);
      }
      if (url.pathname === "/token" || url.pathname === "/revoke") {
        if (request.method !== "POST" || !request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }
        const form = Object.fromEntries(new URLSearchParams(await request.text()));
        if (form["client_id"] !== "fixture-client" || form["client_secret"] !== "fixture-client-secret") {
          return Response.json({ error: "invalid_client" }, { status: 401 });
        }
        if (url.pathname === "/revoke") {
          const token = refresh.get(form["token"] ?? "") ?? tokens.get(form["token"] ?? "");
          if (token) { tokens.delete(token.access); refresh.delete(token.refresh); }
          revocations++;
          return new Response(null, { status: 200 });
        }
        tokenCalls++;
        const parsed = tokenSchema.safeParse(form);
        if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
        switch (parsed.data.grant_type) {
          case "authorization_code": {
            const authorization = codes.get(parsed.data.code);
            codes.delete(parsed.data.code);
            if (!authorization || authorization.redirect_uri !== parsed.data.redirect_uri ||
              createHash("sha256").update(parsed.data.code_verifier).digest("base64url") !== authorization.code_challenge) {
              return Response.json({ error: "invalid_grant" }, { status: 400 });
            }
            return issue(1);
          }
          case "refresh_token": {
            const previous = refresh.get(parsed.data.refresh_token);
            if (!previous) return Response.json({ error: "invalid_grant" }, { status: 400 });
            tokens.delete(previous.access); refresh.delete(previous.refresh);
            return issue(previous.generation + 1);
          }
        }
      }
      if (url.pathname === "/probe") return Response.json({ protocol: "fixture-oauth2" });
      const token = tokens.get((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
      if (!token || token.expiresAt <= now) return Response.json({ error: "invalid_token" }, { status: 401 });
      if (url.pathname === "/me") return Response.json({ id: "fixture-user", generation: token.generation });
      if (url.pathname === "/leak") return Response.json({ access_token: token.access });
      if (url.pathname === "/action" && request.method === "POST") {
        const key = request.headers.get("idempotency-key");
        const body = await request.text();
        const parsed = actionSchema.safeParse(JSON.parse(body));
        if (!key || !parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
        const previous = receipts.get(key);
        if (previous) return previous.body === body ? Response.json(previous.result)
          : Response.json({ error: "idempotency_conflict" }, { status: 409 });
        if (parsed.data.cursor !== cursor) return Response.json({ error: "cursor_conflict" }, { status: 409 });
        const pending = gate;
        if (pending) { gate = null; pending.entered.resolve(); await pending.release.promise; }
        count++;
        cursor = String(count);
        const result = { value: parsed.data.value, cursor };
        receipts.set(key, { body, result });
        return Response.json(result);
      }
      return new Response(null, { status: 404 });
    },
  });
  return {
    origin: server.url.origin, observed, get calls() { return count; }, get tokenCalls() { return tokenCalls; },
    get revocations() { return revocations; }, get activeTokens() { return [...tokens.keys()]; },
    advance(milliseconds: number) { now += milliseconds; },
    pauseNextAction() {
      if (gate) throw new ServiceError("FIXTURE_GATE_BUSY", 500, "An action barrier already exists");
      const pending = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
      gate = pending;
      return { entered: pending.entered.promise, release: () => pending.release.resolve() };
    },
    async [Symbol.asyncDispose]() {
      gate?.release.resolve();
      await server.stop(true);
    },
  };
}
