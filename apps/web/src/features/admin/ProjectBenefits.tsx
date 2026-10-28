import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { ProjectBenefits as Benefits, RequestOf, ResponseOf } from "@quire/contracts";
import { Button, Field, Modal, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import "./project-benefits.css";

type GrantKey = RequestOf<typeof endpoints.adminProjectBenefitsGet>["params"];
type Grant = ResponseOf<typeof endpoints.adminProjectBenefitsGet>;
type Loaded = { readonly scope: GrantKey; readonly grant: Grant };
const numericFields = [
  { name: "compileSeconds", label: "Compile seconds", min: 1, max: 600 },
  { name: "writableMembers", label: "Writable collaborators", min: 0 },
  { name: "historyDays", label: "History days", min: 0 },
] as const;

export function ProjectBenefits({ client }: { readonly client: AdminClient }) {
  const [kind, setKind] = useState("deployment");
  const [key, setKey] = useState("local");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [staged, setStaged] = useState<Benefits | null>(null);

  async function load(input: { readonly kind: string; readonly key: string }, signal?: AbortSignal) {
    const parsed = endpoints.adminProjectBenefitsGet.input.safeParse({ params: input, query: {}, body: undefined });
    if (!parsed.success) { setError("Choose deployment/local, an existing user UUID, or a manual:plan-id / configured:price-id key."); return; }
    setBusy(true); setLoaded(null); setError(""); setMessage(""); setFresh(false); setConfirm(false);
    try {
      const response = await client.call(endpoints.adminProjectBenefitsGet, parsed.data, signal);
      if (signal?.aborted) return;
      if ("error" in response) {
        setError(`${response.error.code}: ${response.error.message}`);
        setFresh(response.error.code === "FRESH_AUTH_REQUIRED");
      } else { setLoaded({ scope: parsed.data.params, grant: response.data }); setStale(false); }
    } catch (failure) { if (!signal?.aborted) setError(errorMessage(failure)); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load({ kind: "deployment", key: "local" }, controller.signal);
    return () => controller.abort();
  }, [client]);

  async function save() {
    if (!loaded) return;
    setBusy(true); setError("");
    try {
      const response = await client.call(endpoints.adminProjectBenefitsPut, {
        params: loaded.scope, query: {},
        body: { benefits: staged, expectedVersion: loaded.grant.version },
      });
      if ("error" in response) {
        setError(`${response.error.code}: ${response.error.message}`);
        setStale(response.error.code === "VERSION_CONFLICT");
        setFresh(response.error.code === "FRESH_AUTH_REQUIRED");
        setConfirm(false);
      } else {
        setLoaded({ scope: loaded.scope, grant: response.data }); setConfirm(false);
        setMessage(`Grant ${staged === null ? "withdrawn" : "saved"} at version ${response.data.version}. Recorded in the audit log.`);
      }
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <section className="project-benefits" aria-labelledby="project-benefits-title">
    <h1 id="project-benefits-title">Project benefits</h1>
    <p>Operator grants set owner project benefits. Restrictions still apply. Prices and plan names do not grant benefits automatically.</p>
    <form className="project-benefits__scope" onSubmit={event => {
      event.preventDefault(); void load({ kind, key });
    }}>
      <label className="admin-label">Grant scope<select value={kind} disabled={busy}
        onChange={event => {
          const next = event.currentTarget.value;
          setKind(next); setKey(next === "deployment" ? "local" : ""); setLoaded(null); setMessage(""); setError("");
        }}>
        <option value="deployment">Deployment baseline</option>
        <option value="user">User grant</option><option value="plan">Plan grant</option>
      </select></label>
      <Field label="Scope key" required value={key} disabled={busy} readOnly={kind === "deployment"}
        placeholder={kind === "user" ? "Existing user UUID" : "configured:price-id or manual:plan-id"}
        onChange={event => { setKey(event.currentTarget.value); setLoaded(null); setError(""); setMessage(""); }}
        hint={kind === "plan" ? "Use the exact configured price ID or a deliberate manual plan ID." : undefined} />
      <Button type="submit" busy={busy}>Load grant</Button>
    </form>
    {error && <p className="admin-message" role="alert">{error}</p>}
    {fresh && <p><a href="/sign-in?returnTo=%2Fadmin%2Fbenefits">Sign in again</a>, then load the grant before retrying.</p>}
    {stale && <p role="status">This grant changed elsewhere. Reload current grant, review the new version, and enter your change again.
      <Button disabled={busy} onClick={() => void load({ kind, key })}>Reload current grant</Button></p>}
    {message && <p role="status">{message}</p>}
    {busy && !loaded && <Spinner label="Loading benefit grant" />}
    {loaded && <div className="admin-resource">
      <h2>{loaded.scope.kind === "deployment" ? "Deployment baseline" : loaded.scope.kind === "user" ? "User grant" : "Plan grant"}</h2>
      <p><strong>{loaded.scope.key}</strong> · Version {loaded.grant.version} · {loaded.grant.benefits === null ? "No grant contribution" : "Grant configured"}</p>
      {loaded.grant.benefits === null && <p>Set all four values to add a contribution. Withdrawing a grant is different from unlimited capacity or history.</p>}
      <form key={`${loaded.scope.kind}/${loaded.scope.key}/${loaded.grant.version}`} className="admin-form"
        onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const parsed = endpoints.adminProjectBenefitsPut.input.safeParse({
            params: loaded.scope, query: {}, body: {
              expectedVersion: loaded.grant.version, benefits: {
                compileSeconds: Number(form.get("compileSeconds")),
                writableMembers: form.has("writableMembersUnlimited") ? null : Number(form.get("writableMembers")),
                historyDays: form.has("historyDaysUnlimited") ? null : Number(form.get("historyDays")),
                trackChanges: form.has("trackChanges"),
              },
            },
          });
          if (!parsed.success) { setError("Enter integer grant values. Compile seconds must be between 1 and 600; other limits must be zero or greater."); return; }
          setStaged(parsed.data.body.benefits); setReviewed(false); setConfirm(true); setError("");
        }}>
        <fieldset disabled={busy || stale || fresh}>
          <legend>Explicit benefit values</legend>
          {numericFields.map(field => <BenefitNumber key={field.name} field={field}
            value={loaded.grant.benefits?.[field.name]} />)}
          <label className="admin-check"><input type="checkbox" name="trackChanges"
            defaultChecked={loaded.grant.benefits?.trackChanges ?? false} />Allow tracked proposals</label>
        </fieldset>
        <div className="project-benefits__actions">
          <Button variant="primary" type="submit" disabled={busy || stale || fresh}>Review grant change</Button>
          {loaded.scope.kind !== "deployment" && loaded.grant.benefits !== null && <Button
            disabled={busy || stale || fresh} onClick={() => {
              setStaged(null); setReviewed(false); setConfirm(true); setError("");
            }}>Withdraw grant…</Button>}
        </div>
      </form>
    </div>}
    <p><a href="/admin/audit">View audit log</a></p>
    <Modal className="project-benefits-confirm" open={confirm} title={staged === null ? "Withdraw benefit grant" : "Confirm benefit grant"}
      onClose={() => { if (!busy) setConfirm(false); }}
      footer={<><Button disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={!reviewed} onClick={() => void save()}>Confirm grant change</Button></>}>
      <p>{loaded?.scope.kind}/{loaded?.scope.key} · Expected version {loaded?.grant.version}</p>
      {staged === null ? <p>Remove only this contribution. The deployment baseline and other grants remain. The withdrawal keeps a versioned record.</p>
        : <dl className="admin-values">
          <div><dt>Compile seconds</dt><dd>{staged.compileSeconds}</dd></div>
          <div><dt>Writable collaborators</dt><dd>{staged.writableMembers ?? "Unlimited"}</dd></div>
          <div><dt>History days</dt><dd>{staged.historyDays ?? "Unlimited"}</dd></div>
          <div><dt>Tracked proposals</dt><dd>{staged.trackChanges ? "Allowed" : "Not granted"}</dd></div>
        </dl>}
      <p>The server requires a fresh operator session. This change is audited and refreshes affected projects.</p>
      <label className="admin-check"><input type="checkbox" checked={reviewed}
        onChange={event => setReviewed(event.currentTarget.checked)} />I reviewed this scope, version and grant change.</label>
    </Modal>
  </section>;
}

function BenefitNumber({ field, value }: {
  readonly field: typeof numericFields[number]; readonly value: number | null | undefined;
}) {
  const [unlimited, setUnlimited] = useState(value === null);
  return <div className="project-benefits__number">
    <Field name={field.name} label={field.label} type="number" inputMode="numeric" min={field.min}
      max={"max" in field ? field.max : undefined} step={1} required={!unlimited} disabled={unlimited}
      defaultValue={value ?? ""} />
    {field.name !== "compileSeconds" && <label className="admin-check">
      <input type="checkbox" name={`${field.name}Unlimited`} checked={unlimited}
        onChange={event => setUnlimited(event.currentTarget.checked)} />Unlimited {field.name === "historyDays" ? "history" : "collaborators"} (null)
    </label>}
  </div>;
}
