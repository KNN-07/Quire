import { useRef, useState } from "react";
import type { SubmitEvent } from "react";
import { endpoints } from "@quire/contracts";
import { Button, Field } from "../../ui";
import type { MarketingPageProps } from "./types";

export function SupportForm({ client, operatorContact }: MarketingPageProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const key = useRef<string | null>(null);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => { const value = data.get(name); return typeof value === "string" ? value : ""; };
    setBusy(true); setError(""); setReceipt("");
    key.current ??= crypto.randomUUID();
    try {
      const result = await client.call(endpoints.supportInquiry, {
        params: {}, query: {}, headers: { "idempotency-key": key.current },
        body: { name: text("name"), email: text("email"), organization: text("organization"),
          users: Number(text("users")), runtime: text("runtime"), airGapped: data.has("airGapped"), message: text("message") },
      });
      if ("error" in result) setError(`${result.error.code}: ${result.error.message}`);
      else { setReceipt(result.requestId); key.current = null; }
    } catch (reason: unknown) {
      if (reason instanceof Error) setError(`Inquiry could not be sent: ${reason.message}`);
      else throw reason;
    } finally { setBusy(false); }
  }
  return <section id="support" className="qm-band"><div className="qm-wrap qm-section qm-split">
    <div><h2>Want help running it?</h2><p className="qm-lead">Ask your operator about installation, identity configuration, or deployment support.</p>
      {operatorContact ? <><a href={`mailto:${operatorContact.email}`}>{operatorContact.email}</a><p>{operatorContact.scope}</p></> : <p>Operator contact and support terms are not configured. Submitting an inquiry does not create a support agreement or response deadline.</p>}
      <p>Describe your deployment and any offline requirements. Do not include passwords or API keys.</p>
    </div>
    <form className="qm-support qm-card" onSubmit={event => void submit(event)} onChange={() => { key.current = null; }}>
      <div className="qm-grid qm-two"><Field label="Name" name="name" required autoComplete="name" /><Field label="Work email" name="email" type="email" required autoComplete="email" /></div>
      <Field label="Organization" name="organization" required autoComplete="organization" />
      <div className="qm-grid qm-two"><Field label="Expected users" name="users" type="number" required min={1} step={1} defaultValue={1} /><label className="q-field"><span className="q-field__label">Deployment runtime</span><select name="runtime" defaultValue="native"><option value="native">Native Bun</option><option value="compose">Docker Compose</option><option value="helm">Kubernetes (Helm)</option><option value="other">Other / undecided</option></select></label></div>
      <label className="qm-checkbox"><input type="checkbox" name="airGapped" />We need an offline / air-gapped deployment</label>
      <label className="q-field"><span className="q-field__label">How can we help?</span><textarea name="message" required rows={4} /></label>
      {error && <p role="alert" className="qm-error">{error}</p>}
      {receipt && <p role="status">Inquiry accepted by this server. Receipt: <code>{receipt}</code></p>}
      <Button type="submit" variant="dark" busy={busy}>Send inquiry</Button>
    </form>
  </div></section>;
}
