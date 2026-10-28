import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { Button } from "../../../ui";
import { editorValue } from "../shared";
import type { AssistantState } from "./use-assistant";

export function AssistantPreferences({ state }: { readonly state: AssistantState }) {
  const prefs = state.preferences;
  const metadata = state.consentMetadata;
  return <details className="qa-assistant__settings"><summary>AI preferences and consent</summary>
    <p>{state.availability}</p>
    <p>Selected content is sent to the operator's configured provider. Provider retention terms are external. Private Ask history is session-local; Agent proposals remain audit records.</p>
    {metadata ? <form key={`consent-${metadata.userVersion}-${metadata.requiredTermsVersion}-${metadata.current}`}
      onSubmit={event => {
      event.preventDefault();
      const consent = new FormData(event.currentTarget).has("accepted");
      void state.execute(async () => {
      const result = editorValue(await state.client.call(endpoints.aiConsent, {
        params: {}, query: {}, body: {
          termsVersion: metadata.requiredTermsVersion, accepted: consent, expectedVersion: metadata.userVersion,
        },
      }, state.signal));
      state.setNotice(`${consent ? "Consent accepted" : "Consent revoked"} · account version ${result.version}`);
      await state.refresh(); await state.refreshWorkspace();
    }); }}>
      <dl className="qa-assistant__consent" aria-label="AI consent metadata">
        <dt>Required terms</dt><dd>{metadata.requiredTermsVersion}</dd>
        <dt>Accepted terms</dt><dd>{metadata.acceptedTermsVersion ?? "None"}</dd>
      </dl>
      <p role="status" aria-label="Consent status">{metadata.current ? "Current consent"
        : metadata.accepted ? "Renewal required" : metadata.acceptedTermsVersion === null ? "Consent not granted" : "Consent revoked"}</p>
      <label className="qa-assistant__check"><input name="accepted" type="checkbox" defaultChecked={metadata.current}
        disabled={state.busy || !state.online} />I consent to these provider terms</label>
      <Button type="submit" disabled={state.busy || !state.online}>Save consent decision</Button>
    </form> : <p role="status">Loading server consent metadata</p>}
    {prefs && <form onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void state.execute(async () => {
        const patch = endpoints.preferencesPatch.input.shape.body.parse({
          aiModel: z.string().parse(form.get("model")).trim() || null,
          aiStyle: form.get("style"), aiMode: form.get("mode"),
          inlineCompletion: form.has("inline"), errorAssist: form.has("error"),
          citationWebSearch: form.has("retrieval"),
          citationProviders: z.string().parse(form.get("providers")).split(",").map(item => item.trim()).filter(Boolean),
          expectedVersion: prefs.version,
        });
        state.setPreferences(editorValue(await state.client.call(endpoints.preferencesPatch, {
          params: {}, query: {}, body: patch,
        }, state.signal)));
        state.setNotice("AI preferences saved");
      });
    }} key={`preferences-${prefs.version}`}>
      <label>Model (empty uses configured default)<input name="model" defaultValue={prefs.aiModel ?? ""} /></label>
      <label>Writing style<select name="style" defaultValue={prefs.aiStyle}>
        <option value="match">Match document</option><option value="academic">Academic</option><option value="plain">Plain</option>
      </select></label>
      <label>Default mode<select name="mode" defaultValue={prefs.aiMode}>
        <option value="ask">Ask</option><option value="agent">Agent</option>
      </select></label>
      <label className="qa-assistant__check"><input name="inline" type="checkbox" defaultChecked={prefs.inlineCompletion} />Enable inline completion</label>
      <label className="qa-assistant__check"><input name="error" type="checkbox" defaultChecked={prefs.errorAssist} />Enable error assistance</label>
      <label className="qa-assistant__check"><input name="retrieval" type="checkbox" defaultChecked={prefs.citationWebSearch} />Consent to citation web retrieval</label>
      <label>Citation providers (comma-separated)<input name="providers" defaultValue={prefs.citationProviders.join(", ")} placeholder="crossref, arxiv" /></label>
      <Button type="submit" disabled={state.busy || !state.online}>Save AI preferences</Button>
    </form>}
    {state.security && <form onSubmit={event => {
      event.preventDefault();
      const confidential = new FormData(event.currentTarget).has("confidential");
      void state.execute(async () => {
        if (!state.security) return;
        state.setSecurity(editorValue(await state.client.call(endpoints.aiSecurityPut, {
          params: state.params, query: {}, headers: state.headers,
          body: { confidential, expectedVersion: state.security.version },
        }, state.signal)));
        state.setNotice("Project security label saved");
      });
    }} key={`security-${state.security.version}`}>
      <label className="qa-assistant__check"><input name="confidential" type="checkbox"
        defaultChecked={state.security.confidential} disabled={state.workspace.access.role !== "owner"} />Confidential project · owner controlled</label>
      <Button type="submit" disabled={state.busy || !state.online || state.workspace.access.role !== "owner"}>Save security label</Button>
    </form>}
  </details>;
}
