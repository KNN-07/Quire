import { SAML, ValidateInResponseTo } from "@node-saml/node-saml";
import type { CacheProvider } from "@node-saml/node-saml";
import { DOMParser } from "@xmldom/xmldom";
import { z } from "zod";
import type { IdentityConfig, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { trustedAttributes } from "./provisioning";

const samlp = "urn:oasis:names:tc:SAML:2.0:protocol";
const saml = "urn:oasis:names:tc:SAML:2.0:assertion";
export function samlDocument(xml: string) {
  if (Buffer.byteLength(xml) > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new ServiceError("SAML_XML_INVALID", 400, "SAML document is too large or contains forbidden declarations");
  }
  return new DOMParser({ onError: () => { throw new ServiceError("SAML_XML_INVALID", 400, "Malformed SAML XML"); } }).parseFromString(xml, "text/xml");
}
export class FederationSaml {
  readonly spIssuer: string;
  readonly callbackUrl: string;
  private readonly cache: CacheProvider;
  constructor(private readonly context: ModuleContext) {
    this.spIssuer = new URL("/api/admin/identity/metadata.xml", context.config.publicUrl).href;
    this.callbackUrl = new URL("/api/auth/saml/acs", context.config.publicUrl).href;
    this.cache = {
      saveAsync: async (key, value) => context.uow.run(async (tx) => {
        await tx.run("DELETE FROM federation_requests WHERE expires_at<=?", [context.clock.now()]);
        await tx.run("DELETE FROM federation_replays WHERE expires_at<=?", [context.clock.now()]);
        await tx.run("INSERT INTO federation_requests(id,created_at,expires_at) VALUES(?,?,?)",
          [key, value, new Date(Date.parse(context.clock.now()) + 600_000).toISOString()]);
        return { value, createdAt: Date.parse(value) };
      }),
      getAsync: async (key) => {
        const row = await context.db.get("SELECT created_at FROM federation_requests WHERE id=? AND consumed_at IS NULL AND expires_at>?", [key, context.clock.now()]);
        return row ? z.object({ created_at: z.string() }).parse(row).created_at : null;
      },
      // Validation prepares proof. Single-use publication is atomic with admission, below.
      removeAsync: async (key) => key,
    };
  }
  client(config: IdentityConfig) {
    if (!config.saml) throw new ServiceError("SAML_UNCONFIGURED", 503, "Missing IdP configuration");
    return new SAML({
      issuer: this.spIssuer, audience: this.spIssuer, callbackUrl: this.callbackUrl,
      entryPoint: config.saml.ssoUrl, idpIssuer: config.saml.entityId, idpCert: [...config.saml.certificates],
      wantAuthnResponseSigned: true, wantAssertionsSigned: true,
      validateInResponseTo: ValidateInResponseTo.always, cacheProvider: this.cache,
      requestIdExpirationPeriodMs: 600_000, acceptedClockSkewMs: 0, maxAssertionAgeMs: 300_000,
      signatureAlgorithm: "sha256", digestAlgorithm: "sha256",
    });
  }
  async verify(config: IdentityConfig, encoded: string) {
    if (!config.saml) throw new ServiceError("SAML_UNCONFIGURED", 503, "Missing IdP configuration");
    const xml = Buffer.from(z.string().max(1400_000).parse(encoded), "base64").toString("utf8");
    const document = samlDocument(xml);
    const response = document.documentElement;
    const assertions = document.getElementsByTagNameNS(saml, "Assertion");
    const assertion = assertions.item(0);
    if (!response || response.namespaceURI !== samlp || response.localName !== "Response" ||
      assertions.length !== 1 || !assertion || assertion.parentNode !== response ||
      response.getAttribute("Destination") !== this.callbackUrl) {
      throw new ServiceError("SAML_RESPONSE_INVALID", 403, "One direct assertion and the exact response destination are required");
    }
    const requestId = response.getAttribute("InResponseTo");
    const assertionId = assertion.getAttribute("ID");
    const conditions = assertion.getElementsByTagNameNS(saml, "Conditions").item(0);
    const confirmation = assertion.getElementsByTagNameNS(saml, "SubjectConfirmationData").item(0);
    const issuer = response.getElementsByTagNameNS(saml, "Issuer").item(0);
    const expiresAt = conditions?.getAttribute("NotOnOrAfter");
    const notBefore = conditions?.getAttribute("NotBefore");
    const now = Date.parse(this.context.clock.now());
    if (!requestId || !assertionId || !expiresAt || !notBefore || !Number.isFinite(Date.parse(expiresAt)) ||
      !Number.isFinite(Date.parse(notBefore)) || Date.parse(expiresAt) <= now || Date.parse(notBefore) > now ||
      !confirmation || confirmation.getAttribute("Recipient") !== this.callbackUrl ||
      confirmation.getAttribute("InResponseTo") !== requestId ||
      !Number.isFinite(Date.parse(confirmation.getAttribute("NotOnOrAfter") ?? "")) ||
      Date.parse(confirmation.getAttribute("NotOnOrAfter") ?? "") <= now ||
      issuer?.parentNode !== response || issuer.textContent !== config.saml.entityId) {
      throw new ServiceError("SAML_CONDITIONS_INVALID", 403, "Issuer, response correlation and bounded subject/condition lifetime required");
    }
    const signatureMethods = document.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "SignatureMethod");
    const digestMethods = document.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "DigestMethod");
    for (let index = 0; index < signatureMethods.length; index++) {
      if (signatureMethods.item(index)?.getAttribute("Algorithm") !== "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256") {
        throw new ServiceError("SAML_ALGORITHM_DENIED", 403, "Only RSA-SHA256 signatures are accepted");
      }
    }
    for (let index = 0; index < digestMethods.length; index++) {
      if (digestMethods.item(index)?.getAttribute("Algorithm") !== "http://www.w3.org/2001/04/xmlenc#sha256") {
        throw new ServiceError("SAML_ALGORITHM_DENIED", 403, "Only SHA256 digests are accepted");
      }
    }
    let validated;
    try { validated = await this.client(config).validatePostResponseAsync({ SAMLResponse: encoded }); }
    catch (error) {
      if (error instanceof Error) throw new ServiceError("SAML_PROOF_INVALID", 403, `SAML validation failed: ${error.message}`);
      throw error;
    }
    if (!validated.profile || validated.loggedOut || validated.profile.issuer !== config.saml.entityId ||
      !validated.profile.nameID) throw new ServiceError("SAML_IDENTITY_INVALID", 403, "Authenticated assertion issuer and NameID required");
    const attributes = z.record(z.string(), z.unknown()).parse(validated.profile["attributes"] ?? validated.profile);
    return {
      issuer: config.saml.entityId, subject: validated.profile.nameID,
      ...trustedAttributes(config, attributes),
      publish: async (tx: Transaction) => {
        const consumed = await tx.run("UPDATE federation_requests SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?",
          [this.context.clock.now(), requestId, this.context.clock.now()]);
        if (consumed.changes !== 1) throw new ServiceError("SAML_REPLAY", 403, "Authentication request expired or already consumed");
        const replay = await tx.run("INSERT INTO federation_replays(issuer,assertion_id,expires_at) VALUES(?,?,?) ON CONFLICT DO NOTHING", [config.saml?.entityId ?? "", assertionId, expiresAt]);
        if (replay.changes !== 1) throw new ServiceError("SAML_REPLAY", 403, "Assertion already used");
      },
    };
  }
}
