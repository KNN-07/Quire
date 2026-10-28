import { generateKeyPair, createHash, sign } from "node:crypto";
import { promisify } from "node:util";
import { assertNever } from "@quire/contracts";
import { z } from "zod";

export type ProviderFault = "none" | "issuer" | "audience" | "nonce" | "expired" | "signature" | "unverified" | "discovery";
export async function providerFixture() {
  const pair = await promisify(generateKeyPair)("rsa", { modulusLength: 2048 });
  const key = pair.publicKey.export({ format: "jwk" });
  const codes = new Map<string, { readonly redirect: string; readonly challenge: string | null; readonly nonce: string; readonly client: string }>();
  const access = new Set<string>();
  const observations: string[] = [];
  const state: { fault: ProviderFault; email: string; subject: string; beforeToken: () => Promise<void>; now: number } = {
    fault: "none", email: "external@example.test",
    subject: "subject-one", beforeToken: async () => {}, now: Date.parse("2026-10-27T00:00:00.000Z") };
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const origin = url.origin;
      if (url.pathname === "/.well-known/openid-configuration") return Response.json({
        issuer: state.fault === "discovery" ? "https://wrong.example.test" : origin,
        authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`,
        jwks_uri: `${origin}/jwks`, id_token_signing_alg_values_supported: ["RS256"],
        response_types_supported: ["code"], code_challenge_methods_supported: ["S256"],
      });
      if (url.pathname === "/jwks") return Response.json({ keys: [{ ...key, kid: "fixture-key", alg: "RS256", use: "sig" }] });
      if (url.pathname === "/authorize" || url.pathname === "/login/oauth/authorize") {
        const params = url.searchParams;
        const client = params.get("client_id");
        const redirect = params.get("redirect_uri");
        if (!client || !redirect || params.get("response_type") !== "code" ||
          (client !== "orcid-client" && params.get("code_challenge_method") !== "S256")) {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }
        const code = crypto.randomUUID();
        codes.set(code, { redirect, client, challenge: params.get("code_challenge"), nonce: params.get("nonce") ?? "" });
        const callback = new URL(redirect);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", params.get("state") ?? "");
        return Response.redirect(callback.href, 302);
      }
      if (url.pathname === "/token" || url.pathname === "/login/oauth/access_token") {
        observations.push("token");
        const form = new URLSearchParams(await request.text());
        const code = form.get("code") ?? "";
        const entry = codes.get(code);
        if (!entry || entry.client !== form.get("client_id") || form.get("client_secret") !== "fixture-client-secret" ||
          entry.redirect !== form.get("redirect_uri") || (entry.challenge !== null && entry.challenge !==
            createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url"))) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        codes.delete(code);
        await state.beforeToken();
        const token = crypto.randomUUID();
        access.add(token);
        const now = Math.floor(state.now / 1000);
        const claims = { iss: origin, sub: state.subject, aud: entry.client, nonce: entry.nonce,
          iat: now, exp: now + 300, name: "External Researcher",
          ...(entry.client === "orcid-client" ? {} : { email: state.email, email_verified: true }) };
        switch (state.fault) {
          case "issuer": claims.iss = "https://attacker.example.test"; break;
          case "audience": claims.aud = "other-client"; break;
          case "nonce": claims.nonce = "different-nonce"; break;
          case "expired": claims.exp = now - 1; break;
          case "unverified": claims.email_verified = false; break;
          case "none": case "signature": case "discovery": break;
          default: assertNever(state.fault);
        }
        const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture-key" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
        const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), pair.privateKey);
        if (state.fault === "signature") signature[0] = (signature[0] ?? 0) ^ 255;
        return Response.json({ access_token: token, token_type: "bearer",
          scope: entry.client === "github-client" ? "read:user,user:email" : "openid",
          id_token: `${header}.${payload}.${signature.toString("base64url")}` });
      }
      if (!access.has((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""))) {
        return Response.json({ error: "invalid_token" }, { status: 401 });
      }
      if (url.pathname === "/user") return Response.json({ id: 142, login: "researcher", name: null, email: "untrusted-profile@example.test" });
      if (url.pathname === "/user/emails") return Response.json([
        { email: "private-unverified@example.test", primary: false, verified: false },
        { email: state.email, primary: true, verified: state.fault !== "unverified" },
      ]);
      return new Response(null, { status: 404 });
    },
  });
  return { origin: server.url.origin, state, observations,
    [Symbol.asyncDispose]: () => server.stop(true) };
}
export const errorSchema = z.object({ error: z.object({ code: z.string() }) });
