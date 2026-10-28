import { Client, InvalidCredentialsError } from "ldapts";
import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import type { FederationConfiguration, FederationDeployment } from "./configuration";
import { trustedAttributes } from "./provisioning";

export class FederationLdap {
  constructor(private readonly deployment: FederationDeployment) {}
  async verify(settings: FederationConfiguration, input: { readonly username: string; readonly password: string }) {
    const config = settings.config.ldap;
    const subjectAttribute = this.deployment.ldapSubjectAttribute;
    if (!config || !settings.ldapSecret || !subjectAttribute) throw new ServiceError("LDAP_UNCONFIGURED", 503, "LDAP configuration, bind secret and immutable subject attribute required");
    if (!this.deployment.ldapAllowedUrls?.includes(config.url)) throw new ServiceError("LDAP_DIRECTORY_DENIED", 403, "Directory URL must exactly match the assembly allowlist");
    const url = new URL(config.url);
    if (!["ldap:", "ldaps:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new ServiceError("LDAP_URL_INVALID", 400, "LDAP URL must not contain credentials, query or fragment");
    }
    if (!input.password || !input.username || input.username.length > 256 || input.password.length > 4096) {
      throw new ServiceError("LDAP_CREDENTIALS_INVALID", 401, "Nonempty bounded username and password required");
    }
    if (config.userFilter.split("{username}").length !== 2) throw new ServiceError("LDAP_FILTER_INVALID", 400, "userFilter must contain exactly one {username}");
    const escaped = input.username.replace(/[\0()*\\]/g, (character) => `\\${character.charCodeAt(0).toString(16).padStart(2, "0")}`);
    const tlsOptions = { ca: [config.caCertificate], rejectUnauthorized: true, minVersion: "TLSv1.2" as const };
    await using client = new Client({ url: config.url, timeout: 10_000, connectTimeout: 5_000, tlsOptions });
    try {
      if (url.protocol === "ldap:") await client.startTLS(tlsOptions);
      await client.bind(config.bindDn, settings.ldapSecret);
      const { searchEntries, searchReferences } = await client.search(config.baseDn, {
        scope: "sub", filter: config.userFilter.replace("{username}", escaped), sizeLimit: 2, timeLimit: 5,
        attributes: [subjectAttribute, settings.config.attributes.email, settings.config.attributes.name, settings.config.attributes.groups],
      });
      const entry = searchEntries[0];
      if (searchEntries.length !== 1 || searchReferences.length || !entry) {
        throw new ServiceError("LDAP_IDENTITY_INVALID", 401, "Directory search must return one user without referrals");
      }
      // Rebind as the returned DN: a successful service-account search is not user authentication.
      await client.bind(entry.dn, input.password);
      const rawSubject = entry[subjectAttribute];
      const subject = z.string().min(1).max(256).parse(Array.isArray(rawSubject) && rawSubject.length === 1 ? rawSubject[0] : rawSubject);
      const attributes = Object.fromEntries(Object.entries(entry).map(([key, value]) =>
        [key, Array.isArray(value) && value.length === 1 && key !== settings.config.attributes.groups ? value[0] : value]));
      return { issuer: config.url, subject, ...trustedAttributes(settings.config, attributes) };
    } catch (error) {
      if (error instanceof InvalidCredentialsError) throw new ServiceError("LDAP_CREDENTIALS_INVALID", 401, "Directory authentication failed");
      if (error instanceof ServiceError) throw error;
      if (error instanceof Error) throw new ServiceError("LDAP_DIRECTORY_FAILED", 502, "Directory TLS, bind or search failed");
      throw error;
    }
  }
}
