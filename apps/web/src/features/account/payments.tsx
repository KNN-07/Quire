import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { BillingAccount, Invoice } from "@quire/contracts";
import { Button } from "../../ui";
import { mutationHeaders, Notice, unwrap, useAction } from "./shared";
import type { AccountPageProps } from "./shared";

export function Payments({ client, billing }: Pick<AccountPageProps, "client"> & { readonly billing: BillingAccount }) {
  const [invoices, setInvoices] = useState<readonly Invoice[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const action = useAction();
  const organizationId = billing.organizationId;
  async function load(signal?: AbortSignal) {
    if (organizationId === null) return;
    const page = unwrap(await client.call(endpoints.billingInvoices, { params: { o: organizationId }, query: { limit: 200 }, body: undefined }, signal));
    setInvoices(page.items); setNextCursor(page.nextCursor); setError("");
  }
  useEffect(() => {
    const controller = new AbortController();
    setInvoices(null); setError("");
    void load(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof Error) setError(cause.message); else throw cause;
    });
    return () => controller.abort();
  }, [client, organizationId]);
  return <div className="account-stack">
    <h3>Payment method</h3>
    <p className="account-muted">Manage payment details on your configured provider’s hosted portal. Quire does not collect card details here.</p>
    <Button busy={action.busy} disabled={organizationId === null} onClick={() => { void action.run(async () => {
      if (organizationId === null) return;
      const result = unwrap(await client.call(endpoints.billingPortal, { params: { o: organizationId }, query: {}, body: { expectedVersion: billing.version }, headers: mutationHeaders() }));
      location.assign(result.url);
    }); }}>Manage payment method</Button>
    <Notice {...action} />
    <h3>Invoices</h3>
    {error ? <><Notice error={error} message="" /><Button onClick={() => { void action.run(async () => { await load(); }); }}>Reload invoices</Button></> : organizationId === null ? <p>No organization billing account is selected.</p> : !invoices ? <p role="status">Loading invoices…</p> : invoices.length === 0 ? <p>No invoices have been issued.</p> : <>
      <table className="account-table"><caption className="q-sr-only">Billing invoices</caption><thead><tr><th scope="col">Issued</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">File</th></tr></thead><tbody>{invoices.map(invoice => <tr key={invoice.id}>
        <td><time dateTime={invoice.issuedAt}>{new Date(invoice.issuedAt).toLocaleDateString(undefined, { year: "2-digit", month: "numeric", day: "numeric" })}</time></td>
        <td>{new Intl.NumberFormat(undefined, { style: "currency", currency: invoice.currency }).format(invoice.amountMinor / 100)}</td><td>{invoice.status}</td>
        <td>{invoice.documentArtifactId ? <a href={client.url(endpoints.invoiceDownload, { params: { o: organizationId, id: invoice.id }, query: {}, body: undefined }).href}>Download</a> : "Not available"}</td>
      </tr>)}</tbody></table>
      {nextCursor && <Button busy={action.busy} onClick={() => { void action.run(async () => {
        const page = unwrap(await client.call(endpoints.billingInvoices, { params: { o: organizationId }, query: { limit: 200, cursor: nextCursor }, body: undefined }));
        setInvoices([...invoices, ...page.items]); setNextCursor(page.nextCursor);
      }); }}>Load more invoices</Button>}
    </>}
  </div>;
}
