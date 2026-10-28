import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import type { Clock } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { SafeHttpClient } from "../shared";

export const discoverySchema = z.object({
  issuer: z.url(), authorization_endpoint: z.url(), token_endpoint: z.url(), jwks_uri: z.url(),
  id_token_signing_alg_values_supported: z.array(z.string()),
  response_types_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()).optional(),
});
const headerSchema = z.object({ alg: z.literal("RS256"), kid: z.string().min(1), crit: z.never().optional() });
const claimsSchema = z.object({
  iss: z.string(), sub: z.string().min(1).max(255),
  aud: z.union([z.string(), z.array(z.string()).min(1)]), azp: z.string().optional(),
  exp: z.number().int(), iat: z.number().int(), nbf: z.number().int().optional(),
  nonce: z.string(), email: z.email().optional(), email_verified: z.boolean().optional(),
  name: z.string().optional(), at_hash: z.string().optional(),
}).passthrough();
const keysSchema = z.object({ keys: z.array(z.object({
  kty: z.string(), kid: z.string().optional(), n: z.string().optional(), e: z.string().optional(),
  alg: z.string().optional(), use: z.string().optional(), key_ops: z.array(z.string()).optional(),
})) });
export type OpenIdExpectation = {
  readonly issuer: string; readonly clientId: string; readonly nonce: string;
  readonly jwksUri: string; readonly accessToken: string;
  readonly strictIssuer?: boolean;
};

export class OpenIdVerifier {
  constructor(private readonly http: SafeHttpClient, private readonly clock: Clock) {}
  async verify(token: string, expected: OpenIdExpectation) {
    try {
      const parts = token.split(".");
      const [headerPart, payloadPart, signature] = parts;
      if (parts.length !== 3 || !headerPart || !payloadPart || !signature ||
        parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
        throw new ServiceError("OIDC_TOKEN_INVALID", 403, "Malformed ID token");
      }
      const header = headerSchema.parse(JSON.parse(Buffer.from(headerPart, "base64url").toString()));
      const keys = await this.http.json(expected.jwksUri, keysSchema, { maxBytes: 128 * 1024 });
      const matches = keys.keys.filter((key) => key.kid === header.kid && key.kty === "RSA" &&
        (!key.alg || key.alg === "RS256") && (!key.use || key.use === "sig") &&
        (!key.key_ops || key.key_ops.includes("verify")));
      const key = matches.length === 1 ? matches[0] : undefined;
      if (!key?.n || !key.e) throw new ServiceError("OIDC_KEY_INVALID", 403, "Signing key not found or ambiguous");
      const publicKey = createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" });
      if (!verify("RSA-SHA256", Buffer.from(`${headerPart}.${payloadPart}`), publicKey, Buffer.from(signature, "base64url"))) {
        throw new ServiceError("OIDC_SIGNATURE_INVALID", 403, "ID token signature is invalid");
      }
      const claims = claimsSchema.parse(JSON.parse(Buffer.from(payloadPart, "base64url").toString()));
      const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
      const now = Math.floor(Date.parse(this.clock.now()) / 1000);
      const issuerMatches = claims.iss === expected.issuer ||
        (!expected.strictIssuer && expected.issuer === "https://accounts.google.com" && claims.iss === "accounts.google.com");
      if (!issuerMatches || !audiences.includes(expected.clientId) ||
        (audiences.length > 1 && claims.azp !== expected.clientId) ||
        (claims.azp !== undefined && claims.azp !== expected.clientId) ||
        claims.nonce !== expected.nonce || claims.exp <= now || claims.iat > now + 30 ||
        claims.iat >= claims.exp || (claims.nbf !== undefined && claims.nbf > now)) {
        throw new ServiceError("OIDC_CLAIMS_INVALID", 403, "ID token issuer, audience, nonce or lifetime is invalid");
      }
      if (claims.at_hash !== undefined && claims.at_hash !== createHash("sha256")
        .update(expected.accessToken).digest().subarray(0, 16).toString("base64url")) {
        throw new ServiceError("OIDC_TOKEN_BINDING_INVALID", 403, "Access token does not match ID token");
      }
      return claims;
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) {
        throw new ServiceError("OIDC_TOKEN_INVALID", 403, "ID token or signing key does not match the protocol");
      }
      throw error;
    }
  }
}
