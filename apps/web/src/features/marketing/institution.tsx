import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Organization } from "@quire/contracts";
import { Button, Field, Spinner } from "../../ui";
import type { MarketingPageProps } from "./types";

export function Institution({ client, path, navigate, onSessionChange }: MarketingPageProps) {
  const slug = decodeURIComponent(path.split(/[?#]/)[0]?.split("/")[2] ?? "");
  const [institution, setInstitution] = useState<Organization | null>(null);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setInstitution(null); setError(""); setReceipt("");
    if (!slug) return undefined;
    const abort = new AbortController();
    void client.call(endpoints.institutionGet, { params: { slug }, query: {}, body: undefined, headers: {} }, abort.signal).then(result => {
      if (!abort.signal.aborted) {
        if ("error" in result) setError(`${result.error.code}: ${result.error.message}`);
        else setInstitution(result.data);
      }
    }).catch((reason: unknown) => { if (!abort.signal.aborted && reason instanceof Error) setError(reason.message); });
    return () => abort.abort();
  }, [client, slug]);
  async function enroll() {
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.institutionEnroll, { params: { slug }, query: {}, body: {}, headers: { "idempotency-key": crypto.randomUUID() } });
      if ("error" in result) setError(`${result.error.code}: ${result.error.message}`);
      else { setReceipt(result.requestId); await onSessionChange(); }
    } catch (reason: unknown) {
      if (reason instanceof Error) setError(reason.message);
      else throw reason;
    } finally { setBusy(false); }
  }
  return <section className="qm-wrap qm-section qm-institution"><h1>{institution?.name ?? "Your institution"}</h1><p className="qm-lead">Find your institution's Quire workspace. Enrollment requires a signed-in account and the institution's verified identity policy.</p>
    <form className="qm-institution-search" onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get("slug"); if (typeof value === "string") navigate(`/institutions/${encodeURIComponent(value.trim())}`); }}>
      <Field key={slug} label="Institution slug" name="slug" required defaultValue={slug} placeholder="Institution identifier" /><Button type="submit">Find institution</Button>
    </form>
    {slug && !institution && !error && <Spinner label="Loading institution" />}
    {error && <p role="alert" className="qm-error">{error}</p>}
    {institution && <article className="qm-card"><h2>Join {institution.name}</h2><p>Verified domains: {institution.domains.join(", ") || "No enrollment domains published"}</p><p>Membership and access are checked by the server. A domain match alone does not grant access.</p>{receipt ? <><p role="status">Enrollment accepted. Receipt: <code>{receipt}</code></p><a href="/projects">Open your projects</a></> : <Button variant="primary" busy={busy} onClick={() => void enroll()}>Join institution</Button>}</article>}
    <p><a href="/sign-in">Sign in</a> · <a href="/self-hosting#support">Ask your operator for your institution identifier</a></p>
  </section>;
}
