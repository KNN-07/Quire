import { generateKeyPair, createHash, sign } from "node:crypto";
import { promisify } from "node:util";
import { assertNever } from "@quire/contracts";

export type ProviderFault = "none" | "issuer" | "audience" | "nonce" | "expired" | "signature" | "unverified" | "discovery";
export async function providerFixture() {
  const primary = await promisify(generateKeyPair)("rsa", { modulusLength: 2048 });
  const rotated = await promisify(generateKeyPair)("rsa", { modulusLength: 2048 });
  const codes = new Map<string, { readonly redirect: string; readonly challenge: string; readonly nonce: string; readonly client: string }>();
  const observations: string[] = [];
  const state: { fault: ProviderFault; email: string; subject: string; beforeToken: () => Promise<void>; now: number; rotated: boolean; groups: string[] } = {
    fault: "none", email: "external@example.test", subject: "subject-one", beforeToken: async () => {},
    now: Date.now(), rotated: false, groups: [] };
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const origin = url.origin;
      if (url.pathname === "/.well-known/openid-configuration") return Response.json({
        issuer: state.fault === "discovery" ? "https://wrong.example.test" : origin,
        authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`,
        jwks_uri: `${origin}/jwks`, id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
        response_types_supported: ["code"], code_challenge_methods_supported: ["S256"],
      });
      const pair = state.rotated ? rotated : primary;
      const kid = state.rotated ? "rotated" : "primary";
      if (url.pathname === "/jwks") return Response.json({ keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] });
      if (url.pathname === "/authorize") {
        const params = url.searchParams;
        const client = params.get("client_id");
        const redirect = params.get("redirect_uri");
        const challenge = params.get("code_challenge");
        if (!client || !redirect || !challenge || params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256") {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }
        const code = crypto.randomUUID();
        codes.set(code, { redirect, client, challenge, nonce: params.get("nonce") ?? "" });
        const callback = new URL(redirect);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", params.get("state") ?? "");
        callback.searchParams.set("iss", origin);
        return Response.redirect(callback.href, 302);
      }
      if (url.pathname !== "/token") return new Response(null, { status: 404 });
      observations.push("token");
      const form = new URLSearchParams(await request.text());
      const code = form.get("code") ?? "";
      const entry = codes.get(code);
      if (!entry || entry.client !== form.get("client_id") ||
        request.headers.get("authorization") !== `Basic ${Buffer.from(`${entry.client}:fixture-client-secret`).toString("base64")}` ||
        entry.redirect !== form.get("redirect_uri") || entry.challenge !== createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url")) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      codes.delete(code);
      await state.beforeToken();
      const now = Math.floor(state.now / 1000);
      const claims = { iss: origin, sub: state.subject, aud: entry.client, nonce: entry.nonce,
        iat: now, exp: now + 300, name: "External Researcher", email: state.email, email_verified: true, groups: state.groups };
      switch (state.fault) {
        case "issuer": claims.iss = "https://attacker.example.test"; break;
        case "audience": claims.aud = "other-client"; break;
        case "nonce": claims.nonce = "different-nonce"; break;
        case "expired": claims.exp = now - 1; break;
        case "unverified": claims.email_verified = false; break;
        case "none": case "signature": case "discovery": break;
        default: assertNever(state.fault);
      }
      const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), pair.privateKey);
      if (state.fault === "signature") signature[0] = (signature[0] ?? 0) ^ 255;
      return Response.json({ access_token: crypto.randomUUID(), token_type: "bearer",
        id_token: `${header}.${payload}.${signature.toString("base64url")}` });
    },
  });
  return { origin: server.url.origin, state, observations, [Symbol.asyncDispose]: () => server.stop(true) };
}
