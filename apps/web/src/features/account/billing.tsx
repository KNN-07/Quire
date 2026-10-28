import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { BillingAccount, Organization, ResponseOf } from "@quire/contracts";
import { Button, Field } from "../../ui";
import { listInput, mutationHeaders, Notice, Panel, readInput, Select, unwrap, useAction, value } from "./shared";
import type { SettingsProps } from "./settings";
import { Payments } from "./payments";
import { checkoutDestination } from "./billing-navigation";

export function Billing(props: SettingsProps) {
  const [catalog, setCatalog] = useState<ResponseOf<typeof endpoints.billingCatalog> | null>(null);
  const [organizations, setOrganizations] = useState<readonly Organization[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [billing, setBilling] = useState<BillingAccount | null>(null);
  const [quote, setQuote] = useState<ResponseOf<typeof endpoints.billingPreview> | null>(null);
  const [error, setError] = useState("");
  const [billingError, setBillingError] = useState("");
  const action = useAction();
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([props.client.call(endpoints.billingCatalog, readInput, controller.signal), props.client.call(endpoints.organizationsList, listInput, controller.signal)]).then(([plans, orgs]) => {
      setCatalog(unwrap(plans)); const list = unwrap(orgs).items; setOrganizations(list); setOrganization(list[0] ?? null);
    }).catch((cause: unknown) => { if (controller.signal.aborted) return; if (cause instanceof Error) setError(cause.message); else throw cause; });
    return () => controller.abort();
  }, [props.client]);
  useEffect(() => {
    setBilling(null); setBillingError(""); setQuote(null);
    if (!organization) return undefined;
    const controller = new AbortController();
    void props.client.call(endpoints.billingGet, { params: { o: organization.id }, query: {}, body: undefined }, controller.signal).then(result => setBilling(unwrap(result))).catch((cause: unknown) => {
      if (controller.signal.aborted) return; if (cause instanceof Error) setBillingError(cause.message); else throw cause;
    });
    return () => controller.abort();
  }, [props.client, organization]);
  return <Panel title="Billing">
    {error ? <Notice error={error} message="" /> : !catalog ? <p role="status">Loading billing catalog…</p> : <>
      <h3>Available plans</h3>
      {!catalog.configured ? <p>Billing is not configured. Local/server capabilities are unlocked; no payment is collected here.</p> : catalog.plans.length === 0 ? <p>The operator has not published any plans.</p> : <ul className="account-list">{catalog.plans.map(plan => <li key={plan.id}>{plan.name} · {new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency }).format(plan.amountMinor / 100)} / {plan.period}</li>)}</ul>}
      {organizations.length > 0 ? <label className="q-field"><span className="q-field__label">Organization</span><select className="q-input" value={organization?.id ?? ""} onChange={event => setOrganization(organizations.find(org => org.id === event.target.value) ?? null)}>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label> : <p>No organization billing account is available. Personal subscription billing is not exposed by this server.</p>}
      {billingError && <Notice error={billingError} message="" />}
      {organization && !billing && !billingError && <p role="status">Loading organization billing…</p>}
      {billing && organization && <>
        <h3>Current subscription</h3><p>{billing.status === "unbilled" ? "Unbilled" : billing.status.replace("_", " ")} · {catalog.plans.find(plan => plan.id === billing.planId)?.name ?? billing.planId ?? "No plan"} · {billing.seats} seats</p>
        {billing.renewsAt && <p>Renews {new Date(billing.renewsAt).toLocaleDateString()}</p>}
        {catalog.configured && catalog.plans.length > 0 && <form className="account-form" onSubmit={event => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void action.run(async () => {
            const plan = catalog.plans.find(candidate => candidate.id === value(form, "plan"));
            if (!plan) return;
            setQuote(unwrap(await props.client.call(endpoints.billingPreview, { params: { o: organization.id }, query: {}, body: { planId: plan.id, seats: Number(value(form, "seats")), period: plan.period, expectedVersion: billing.version }, headers: mutationHeaders() })));
          });
        }}>
          <Select label="Plan" name="plan" defaultValue={billing.planId ?? catalog.plans[0]?.id ?? ""} options={catalog.plans.map(plan => [plan.id, `${plan.name} (${plan.period})`] as const)} />
          <Field label="Seats" type="number" name="seats" min={1} step={1} required defaultValue={Math.max(1, billing.seats)} />
          <Button type="submit" variant="primary" busy={action.busy}>Preview plan</Button>
        </form>}
        {quote && <div className="account-stack"><h3>Plan quote</h3><p>{new Intl.NumberFormat(undefined, { style: "currency", currency: quote.currency }).format(quote.amountMinor / 100)} · Valid until {new Date(quote.expiresAt).toLocaleString()}</p>
          <Button busy={action.busy} onClick={() => { void action.run(async () => {
            const operation = unwrap(await props.client.call(endpoints.billingCheckout, { params: { o: organization.id }, query: {}, body: { quoteId: quote.quoteId, expectedVersion: billing.version }, headers: mutationHeaders() }));
            const destination = checkoutDestination(operation);
            action.setMessage(`Checkout request ${operation.status}. Payment is not confirmed.${operation.result?.["reconciliation"] === "awaiting_webhook" ? " Awaiting provider webhook reconciliation." : ""}`);
            if (destination) location.assign(destination);
          }); }}>Request checkout</Button></div>}
        <h3>Invoice details</h3>
        <form key={billing.id + ":" + billing.version} className="account-form" onSubmit={event => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void action.run(async () => {
            setBilling(unwrap(await props.client.call(endpoints.billingDetails, { params: { o: organization.id }, query: {}, body: { invoiceEmail: value(form, "invoiceEmail"), taxId: value(form, "taxId"), address: value(form, "address"), expectedVersion: billing.version } })));
            action.setMessage("Invoice details saved.");
          });
        }}>
          <Field label="Invoice email" name="invoiceEmail" type="email" required defaultValue={billing.invoiceEmail} />
          <Field label="Tax ID" name="taxId" defaultValue={billing.taxId} />
          <label className="q-field"><span className="q-field__label">Billing address</span><textarea className="q-input" name="address" defaultValue={billing.address} /></label>
          <Button type="submit" busy={action.busy}>Save invoice details</Button>
        </form>
        <Payments client={props.client} billing={billing} />
        {billing.status === "active" && <form className="account-form" onSubmit={event => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void action.run(async () => {
            if (!form.has("confirm")) return;
            const operation = unwrap(await props.client.call(endpoints.billingCancel, { params: { o: organization.id }, query: {}, body: { atPeriodEnd: true, expectedVersion: billing.version }, headers: mutationHeaders() }));
            setBilling(unwrap(await props.client.call(endpoints.billingGet, { params: { o: organization.id }, query: {}, body: undefined })));
            action.setMessage(`Cancellation request ${operation.status}. The subscription status above is the server record.`);
          });
        }}><label className="account-check"><span>Cancel this subscription at the end of its billing period</span><input type="checkbox" name="confirm" required /></label><Button type="submit" variant="danger" busy={action.busy}>Request cancellation</Button></form>}
      </>}
    </>}
    <Notice {...action} />
  </Panel>;
}
