import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { ResponseOf } from "@quire/contracts";
import { Button, Spinner } from "../../ui";
import type { MarketingPageProps } from "./types";
import { billingPlanPath } from "./pricing-selection";
import { pricingComparison } from "./pricing-comparison";

export function Pricing({ client, navigate }: MarketingPageProps) {
  const [catalog, setCatalog] = useState<ResponseOf<typeof endpoints.billingCatalog> | null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"month" | "year">("year");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void client.call(endpoints.billingCatalog, { params: {}, query: {}, body: undefined, headers: {} }, abort.signal).then(result => {
      if (!abort.signal.aborted) {
        if ("error" in result) setError(`${result.error.code}: ${result.error.message}`);
        else { setCatalog(result.data); setError(""); }
      }
    }).catch((reason: unknown) => {
      if (!abort.signal.aborted && reason instanceof Error) setError(reason.message);
    });
    return () => abort.abort();
  }, [client, attempt]);
  return <>
    <section className="qm-wrap qm-hero qm-pricing-hero"><h1>Choose your plan</h1><p>Start with the unbilled local edition. Hosted plans, billing periods and amounts are configured by your operator.</p><div className="qm-period" role="group" aria-label="Billing period"><Button aria-pressed={period === "month"} onClick={() => setPeriod("month")}>Monthly</Button><Button aria-pressed={period === "year"} onClick={() => setPeriod("year")}>Annually</Button></div></section>
    <section className="qm-plans" aria-label="Plans"><div className="qm-grid qm-plan-grid">
      <article className="qm-card"><h2>Local edition</h2><p>Run Quire on infrastructure you control.</p><p className="qm-price">Unbilled</p><small>No license key or commercial feature gates</small><a className="qm-link-button qm-primary" href="/self-hosting#install">Use local edition</a><ul><li>Local SQLite and disk storage</li><li>Real project repositories</li><li>Configurable project and account policy</li><li>External providers are optional</li></ul></article>
      {!catalog && !error && <div className="qm-card"><Spinner label="Loading operator pricing" /></div>}
      {error && <div className="qm-card"><h2>Operator pricing unavailable</h2><p role="alert">{error}</p><Button onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry pricing</Button></div>}
      {catalog && !catalog.configured && <article className="qm-card"><h2>Hosted plans</h2><p className="qm-price">Not configured</p><p>No operator prices or billing promises have been published for this installation.</p><a className="qm-link-button" href="/self-hosting#support">Contact the operator</a></article>}
      {catalog?.configured && catalog.plans.filter(plan => plan.period === period).map(plan => {
        const target = billingPlanPath(plan);
        const signIn = `/sign-in?${new URLSearchParams({ returnTo: target })}`;
        return <article className="qm-card" key={plan.id}><h2>{plan.name}</h2><p className="qm-price">{new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency }).format(plan.amountMinor / 100)}</p><p>Per {plan.period} · {plan.currency}</p><p>Operator-configured amount. Tax and service scope must be confirmed with the operator. Organization billing only; personal subscriptions are not available.</p><a className="qm-link-button" href={signIn} onClick={event => {
          event.preventDefault();
          void client.call(endpoints.me, { params: {}, query: {}, body: undefined, headers: {} }).then(result => navigate("error" in result ? signIn : target)).catch(() => navigate(signIn));
        }}>Choose {plan.name}</a></article>;
      })}
      {catalog?.configured && !catalog.plans.some(plan => plan.period === period) && <article className="qm-card"><h2>No {period === "year" ? "annual" : "monthly"} plans</h2><p>The operator has not configured plans for this billing period.</p></article>}
      <article className="qm-card qm-tonal"><h2>Organizations</h2><p>For labs, departments and institutions.</p><p className="qm-price">Contact operator</p><p>Enrollment, support and identity configuration follow your institution's policy.</p><a className="qm-link-button" href="/institutions">Find your institution</a><a href="/self-hosting#support">Ask about support</a></article>
    </div></section>
    <section className="qm-wrap qm-section"><h2>Compare options</h2><p>The catalog publishes amounts and billing periods, not per-plan feature entitlements. Local capabilities below depend on installation and access policy. No seat cap, trial, retention promise or AI allowance is inferred from a price. Confirm hosted terms with your operator.</p>
      <div className="qm-comparison">{pricingComparison.map(group => <section className="qm-comparison-group" key={group.name} aria-label={group.name}><h3>{group.name}</h3><div className="qm-table-wrap"><table><caption className="qm-comparison-caption">{group.name} comparison</caption><thead><tr><th scope="col">Feature</th><th scope="col">Local edition</th><th scope="col">Operator-hosted plans</th></tr></thead><tbody>{group.rows.map(([topic, local]) => <tr key={topic}><th scope="row">{topic}</th><td>{local}</td><td className="qm-comparison-operator">Set by your operator</td></tr>)}</tbody></table></div></section>)}</div>
    </section>
    <section className="qm-band"><div className="qm-faq qm-section"><h2>Billing questions</h2><details open><summary>Do my collaborators need a paid plan?</summary><p>The local edition has no commercial feature gates. Sharing and account policy are configured by your operator.</p></details><details><summary>What counts as an AI use?</summary><p>Provider budgets and model availability follow your operator's configuration. Quire does not publish a default paid allowance.</p></details><details><summary>Who can get a Student plan?</summary><p>Eligibility exists only when your operator offers and defines it. No student price is assumed.</p></details><details><summary>What happens if I change plans?</summary><p>Ask your operator about billing and policy changes before choosing a plan. No automatic deletion or support commitment is implied here.</p></details><details><summary>Do you accept purchase orders?</summary><p>Purchase orders, invoicing and tax terms require an agreement with the operator.</p><a href="/self-hosting#support">Contact the operator</a></details></div></section>
    <section className="qm-wrap qm-section qm-center"><h2>Not sure which option fits?</h2><div className="qm-actions"><a className="qm-link-button" href="/self-hosting">Host Quire yourself</a><a href="/self-hosting#support">Talk to us</a></div></section>
  </>;
}
