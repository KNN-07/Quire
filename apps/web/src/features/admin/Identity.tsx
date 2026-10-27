import { useEffect, useState } from "react";
import { endpoints, IdentityConfigSchema } from "@quire/contracts";
import type { IdentityConfig } from "@quire/contracts";
import { Button, Field, Modal, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { downloadBytes, errorMessage } from "./api";
import { IdentityAccess } from "./IdentityAccess";
import { ScimToken } from "./ScimToken";
import { DataView } from "./DataView";

const emptySaml = { entityId: "", ssoUrl: "", metadataXml: "", certificates: [] } as const;
const emptyOidc = { issuer: "", clientId: "", scopes: [], secretPresent: false } as const;
const emptyLdap = { url: "", baseDn: "", bindDn: "", userFilter: "", caCertificate: "", secretPresent: false } as const;

export function Identity({ client }: { readonly client: AdminClient }) {
  const [config, setConfig] = useState<IdentityConfig | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [certificates, setCertificates] = useState("");
  const [oidcSecret, setOidcSecret] = useState<string | undefined>();
  const [ldapSecret, setLdapSecret] = useState<string | undefined>();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState<IdentityConfig | null>(null);
  const [result, setResult] = useState<unknown>(undefined);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setConfig(null);
    void client.callWithMetadata(endpoints.identityConfigGet, { params: {}, query: {}, body: undefined }, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if ("error" in response.result) setMessage(`${response.result.error.code}: ${response.result.error.message}`);
      else {
        setConfig(response.result.data);
        setCertificates(response.result.data.saml?.certificates.join("\n\n") ?? "");
        setOidcSecret(undefined); setLdapSecret(undefined);
        setEtag(response.metadata.etag);
        setMessage("");
      }
      setLoading(false);
    }).catch((error: unknown) => { if (!controller.signal.aborted) { setMessage(errorMessage(error)); setLoading(false); } });
    return () => controller.abort();
  }, [client, refresh]);
  function draft() {
    const saml = config?.saml || certificates.trim() ? {
      ...emptySaml, ...config?.saml,
      certificates: certificates.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean),
    } : null;
    return IdentityConfigSchema.parse({ ...config, saml });
  }
  async function testConnection() {
    setBusy(true);
    try {
      const response = await client.call(endpoints.identityTest, {
        params: {}, query: {}, body: { draftConfig: draft(), nonce: crypto.randomUUID(),
          ...(oidcSecret === undefined ? {} : { oidcSecret }), ...(ldapSecret === undefined ? {} : { ldapSecret }) },
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      if ("error" in response) setMessage(`${response.error.code}: ${response.error.message}`);
      else { setResult(response.data); setMessage("Handshake operation submitted. Its returned status is not proof of a successful login."); }
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!pending || !etag) return;
    setBusy(true);
    try {
      const { version, ...writable } = pending;
      const response = await client.callWithMetadata(endpoints.identityConfigPut, {
        params: {}, query: {}, body: { ...writable, expectedVersion: version,
          ...(oidcSecret === undefined ? {} : { oidcSecret }), ...(ldapSecret === undefined ? {} : { ldapSecret }) },
        headers: { "if-match": etag },
      });
      if ("error" in response.result) setMessage(`${response.result.error.code}: ${response.result.error.message}`);
      else {
        setConfig(response.result.data);
        setOidcSecret(undefined); setLdapSecret(undefined);
        setCertificates(response.result.data.saml?.certificates.join("\n\n") ?? "");
        setEtag(response.metadata.etag);
        setMessage("Identity configuration saved by the server.");
        setConfirm(false);
      }
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function metadata() {
    setBusy(true);
    try {
      const response = await client.call(endpoints.identityMetadata, { params: {}, query: {}, body: undefined });
      if ("error" in response) setMessage(`${response.error.code}: ${response.error.message}`);
      else downloadBytes(response.data, "quire-metadata.xml");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <>
    <div className="admin-row"><h1>Authentication</h1><Button onClick={() => setRefresh(previous => previous + 1)} disabled={busy || loading}>Reload identity</Button></div>
    <p>Operator-only SAML, OIDC and LDAP configuration. Keep a password-enabled break-glass operator before enforcing SSO.</p>
    {loading && <Spinner label="Loading identity configuration" />}
    {message && <p role="status" className="admin-message">{message}</p>}
    {config && <form className="admin-form" onSubmit={event => {
      event.preventDefault();
      try { setPending(draft()); setConfirm(true); } catch (error) { setMessage(errorMessage(error)); }
    }}>
      <label className="admin-label">Protocol<select name="protocol" value={config.protocol} onChange={event => {
        const protocol = IdentityConfigSchema.unwrap().shape.protocol.parse(event.currentTarget.value);
        setConfig({ ...config, protocol });
      }}><option value="saml">SAML</option><option value="oidc">OIDC</option><option value="ldap">LDAP</option></select></label>
      <fieldset><legend>{config.protocol.toUpperCase()} provider</legend>
        {config.protocol === "saml" && <>
          <Field name="entityId" label="Entity ID" value={config.saml?.entityId ?? ""} onChange={event => setConfig({ ...config, saml: { ...emptySaml, ...config.saml, entityId: event.currentTarget.value } })} />
          <Field name="ssoUrl" label="SSO URL" value={config.saml?.ssoUrl ?? ""} onChange={event => setConfig({ ...config, saml: { ...emptySaml, ...config.saml, ssoUrl: event.currentTarget.value } })} />
          <label className="admin-label">Metadata XML<textarea value={config.saml?.metadataXml ?? ""} onChange={event => setConfig({ ...config, saml: { ...emptySaml, ...config.saml, metadataXml: event.currentTarget.value } })} /></label>
          <label className="admin-label">Trusted certificates (separate PEM blocks with a blank line)<textarea name="certificates" value={certificates} onChange={event => setCertificates(event.currentTarget.value)} /></label>
        </>}
        {config.protocol === "oidc" && <>
          <Field name="issuer" label="Issuer" value={config.oidc?.issuer ?? ""} onChange={event => setConfig({ ...config, oidc: { ...emptyOidc, ...config.oidc, issuer: event.currentTarget.value } })} />
          <Field name="clientId" label="Client ID" value={config.oidc?.clientId ?? ""} onChange={event => setConfig({ ...config, oidc: { ...emptyOidc, ...config.oidc, clientId: event.currentTarget.value } })} />
          <Field name="scopes" label="Scopes (space separated)" value={config.oidc?.scopes.join(" ") ?? ""} onChange={event => setConfig({ ...config, oidc: { ...emptyOidc, ...config.oidc, scopes: event.currentTarget.value.split(/\s+/).filter(Boolean) } })} />
          <Field label="Client secret" type="password" autoComplete="new-password" value={oidcSecret ?? ""}
            hint={config.oidc?.secretPresent ? "Stored secret retained unless replaced or removed." : "No client secret stored."}
            onChange={event => setOidcSecret(event.currentTarget.value || undefined)} />
          {config.oidc?.secretPresent && <label className="admin-check"><input type="checkbox" checked={oidcSecret === ""}
            onChange={event => setOidcSecret(event.currentTarget.checked ? "" : undefined)} />Remove stored client secret</label>}
        </>}
        {config.protocol === "ldap" && <>
          {(["url", "baseDn", "bindDn", "userFilter"] as const).map(key => <Field key={key} label={{ url: "Directory TLS URL", baseDn: "Base DN", bindDn: "Bind DN", userFilter: "User filter" }[key]}
            value={config.ldap?.[key] ?? ""} onChange={event => setConfig({ ...config, ldap: { ...emptyLdap, ...config.ldap, [key]: event.currentTarget.value } })} />)}
          <label className="admin-label">CA certificate<textarea name="caCertificate" value={config.ldap?.caCertificate ?? ""} onChange={event => setConfig({ ...config, ldap: { ...emptyLdap, ...config.ldap, caCertificate: event.currentTarget.value } })} /></label>
          <Field label="Bind secret" type="password" autoComplete="new-password" value={ldapSecret ?? ""}
            hint={config.ldap?.secretPresent ? "Stored secret retained unless replaced or removed." : "No bind secret stored."}
            onChange={event => setLdapSecret(event.currentTarget.value || undefined)} />
          {config.ldap?.secretPresent && <label className="admin-check"><input type="checkbox" checked={ldapSecret === ""}
            onChange={event => setLdapSecret(event.currentTarget.checked ? "" : undefined)} />Remove stored bind secret</label>}
        </>}
      </fieldset>
      <fieldset><legend>Attributes & access policy</legend>
        {(["email", "name", "groups"] as const).map(key => <Field key={key} label={`${key.charAt(0).toUpperCase() + key.slice(1)} attribute`} value={config.attributes[key]}
          onChange={event => setConfig({ ...config, attributes: { ...config.attributes, [key]: event.currentTarget.value } })} />)}
        <Field label="Allowed domains (comma separated)" value={config.domains.join(", ")} onChange={event => setConfig({ ...config, domains: event.currentTarget.value.split(",").map(value => value.trim()).filter(Boolean) })} />
        {(["enabled", "requireSso", "createOnLogin"] as const).map(key => <label className="admin-check" key={key}>
          <input type="checkbox" checked={config[key]} onChange={event => setConfig({ ...config, [key]: event.currentTarget.checked })} />
          {{ enabled: "Enable identity provider", requireSso: "Require SSO", createOnLogin: "Create accounts on login" }[key]}</label>)}
      </fieldset>
      <IdentityAccess client={client} config={config} onChange={setConfig} />
      <div className="admin-row"><Button busy={busy} onClick={() => void testConnection()}>Test connection</Button>
        <Button disabled={busy} onClick={() => void metadata()}>Download SP metadata</Button>
        <Button variant="primary" type="submit" disabled={busy || !etag}>Save identity</Button></div>
      {!etag && <p role="alert">Server did not return a resource ETag. Saving is disabled to avoid an unchecked overwrite.</p>}
    </form>}
    {config && <ScimToken client={client} />}
    {result !== undefined && <section aria-label="Identity test operation"><DataView value={result} /></section>}
    <Modal open={confirm} onClose={() => { if (!busy) setConfirm(false); }} title="Confirm identity policy"
      description="This may change how every account signs in. Ensure the break-glass user can still sign in with a password."
      footer={<><Button disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" busy={busy} onClick={() => void save()}>Confirm identity save</Button></>}>
      <p>Protocol: {pending?.protocol.toUpperCase()}. Require SSO: {pending?.requireSso ? "yes" : "no"}.</p>
      <p>Break-glass user: {pending?.breakGlassUserId}</p>
    </Modal>
  </>;
}
