import { expect, test } from "bun:test";
import { generateKeyPair, sign } from "node:crypto";
import { promisify } from "node:util";
import { InstantSchema } from "@quire/contracts";
import { OpenIdVerifier } from "../../../services/adapters/identity/oidc";
import { SafeHttpClient } from "../../../services/adapters/shared";

test("retains signed custom claims and applies strict federation issuer matching", async () => {
  const pair = await promisify(generateKeyPair)("rsa", { modulusLength: 2048 });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => Response.json({ keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" }] }),
  });
  const at = InstantSchema.parse("2026-10-27T00:00:00.000Z");
  const now = Date.parse(at) / 1000;
  const claims = { iss: "https://idp.example.test", sub: "subject", aud: "client", nonce: "nonce",
    iat: now, exp: now + 120, groups: ["writers"], employee_id: "verified-employee" };
  const token = (payload: typeof claims) => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), pair.privateKey).toString("base64url")}`;
  };
  try {
    const verifier = new OpenIdVerifier(new SafeHttpClient({ fixtureOrigins: [server.url.origin] }), { now: () => at });
    const expected = { issuer: claims.iss, clientId: "client", nonce: "nonce", jwksUri: server.url.href, accessToken: "access" };
    const signed = token(claims);
    const verified = await verifier.verify(signed, { ...expected, strictIssuer: true });
    expect(verified["groups"]).toEqual(["writers"]);
    expect(verified["employee_id"]).toBe("verified-employee");
    const parts = signed.split(".");
    parts[1] = Buffer.from(JSON.stringify({ ...claims, groups: ["administrators"] })).toString("base64url");
    const tampered = await verifier.verify(parts.join("."), expected).then(() => null, (error: unknown) => error);
    expect(tampered).toMatchObject({ code: "OIDC_SIGNATURE_INVALID" });
    const google = { ...expected, issuer: "https://accounts.google.com" };
    const legacy = token({ ...claims, iss: "accounts.google.com" });
    expect((await verifier.verify(legacy, google)).sub).toBe("subject");
    const rejected = await verifier.verify(legacy, { ...google, strictIssuer: true }).then(() => null, (error: unknown) => error);
    expect(rejected).toMatchObject({ code: "OIDC_CLAIMS_INVALID" });
    expect((await verifier.verify(token({ ...claims, iss: google.issuer }), { ...google, strictIssuer: true })).sub).toBe("subject");
  } finally { await server.stop(true); }
});
