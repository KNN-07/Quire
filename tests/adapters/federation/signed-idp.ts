import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";

export async function certificate() {
  const path = await mkdtemp(join(tmpdir(), "quire-federation-certificate-"));
  try {
    const keyPath = join(path, "key.pem");
    const certPath = join(path, "cert.pem");
    const process = Bun.spawn(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", keyPath, "-out", certPath, "-days", "2", "-subj", "/CN=127.0.0.1",
      "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdout: "pipe", stderr: "pipe" });
    const [exit, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);
    if (exit !== 0) throw new TypeError(`Certificate generation failed ${exit}: ${stderr}`);
    return { key: await Bun.file(keyPath).text(), cert: await Bun.file(certPath).text(), path,
      [Symbol.asyncDispose]: () => rm(path, { recursive: true, force: true }) };
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
}
export type SamlFault = "none" | "signature" | "unsigned-response" | "unsigned-assertion" | "issuer" | "audience" | "destination" | "expired" | "request" | "recipient";
export function signedResponse(input: {
  readonly requestId: string; readonly issuer: string; readonly audience: string; readonly destination: string;
  readonly key: string; readonly cert: string; readonly fault?: SamlFault; readonly assertionId?: string;
}) {
  const fault = input.fault ?? "none";
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + (fault === "expired" ? -60_000 : 240_000)).toISOString();
  const before = new Date(Date.now() - 60_000).toISOString();
  const requestId = fault === "request" ? "_wrong" : input.requestId;
  const issuer = fault === "issuer" ? "https://wrong.invalid" : input.issuer;
  const destination = fault === "destination" ? "https://wrong.invalid/acs" : input.destination;
  const audience = fault === "audience" ? "https://wrong.invalid/sp" : input.audience;
  const recipient = fault === "recipient" ? "https://wrong.invalid/recipient" : input.destination;
  const assertionId = input.assertionId ?? `_${crypto.randomUUID()}`;
  const responseId = `_${crypto.randomUUID()}`;
  let xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${now}" Destination="${destination}" InResponseTo="${requestId}"><saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${now}"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID>signed-researcher</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${requestId}" Recipient="${recipient}" NotOnOrAfter="${expires}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${before}" NotOnOrAfter="${expires}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now}" SessionIndex="_session"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>signed@example.test</saml:AttributeValue></saml:Attribute><saml:Attribute Name="name"><saml:AttributeValue>Signed Researcher</saml:AttributeValue></saml:Attribute><saml:Attribute Name="groups"><saml:AttributeValue>Researchers</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`;
  function sign(target: "Response" | "Assertion", document: string) {
    const signer = new SignedXml({
      privateKey: input.key, publicCert: input.cert,
      canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
      signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    });
    signer.addReference({ xpath: `//*[local-name(.)='${target}']`,
      transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256" });
    signer.computeSignature(document, { location: { reference: `//*[local-name(.)='${target}']/*[local-name(.)='Issuer']`, action: "after" } });
    return signer.getSignedXml();
  }
  if (fault !== "unsigned-assertion") xml = sign("Assertion", xml);
  if (fault !== "unsigned-response") xml = sign("Response", xml);
  if (fault === "signature") xml = xml.replace("signed@example.test", "attacker@example.test");
  return Buffer.from(xml).toString("base64");
}
export function authnRequestId(location: string): string {
  const encoded = new URL(location).searchParams.get("SAMLRequest");
  if (!encoded) throw new TypeError("Missing AuthnRequest");
  const xml = inflateRawSync(Buffer.from(encoded, "base64")).toString();
  const id = new DOMParser().parseFromString(xml, "text/xml").documentElement?.getAttribute("ID");
  if (!id) throw new TypeError("Missing AuthnRequest ID");
  return id;
}
