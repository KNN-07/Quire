import { createHmac } from "node:crypto";
import { z } from "zod";
import { apiVersion } from "../../../services/adapters/billing/contracts";

export const invoiceBytes = new TextEncoder().encode("%PDF-1.7\nStripe fixture invoice bytes\n%%EOF");
export function stripeFixture() {
  const prices = new Map(["month", "year"].map((interval) => [`price_${interval}`, {
    id: `price_${interval}`, active: true, type: "recurring", billing_scheme: "per_unit",
    unit_amount: interval === "month" ? 1500 : 15000, currency: "usd", transform_quantity: null,
    recurring: { interval, interval_count: 1, usage_type: "licensed" },
  }]));
  let organization = "";
  let quantity = 2;
  let price = "price_month";
  let state: "active" | "past_due" | "canceled" = "active";
  let cancelAtPeriodEnd = false;
  let failedCheckout = false;
  let complete = false;
  const calls: { readonly path: string; readonly fields: Readonly<Record<string, string>> }[] = [];
  const receipts = new Map<string, { readonly body: string; readonly response: unknown }>();
  let barrier: { readonly arrived: () => void; readonly release: Promise<void> } | null = null;
  const subscription = () => ({
    id: "sub_fixture", customer: "cus_fixture", metadata: { quire_organization: organization },
    status: state, cancel_at_period_end: cancelAtPeriodEnd,
    items: { has_more: false, data: [{ id: "si_fixture", price: prices.get(price), quantity,
      current_period_start: 1793102400, current_period_end: 1795780800 }] },
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/invoice.pdf") return new Response(invoiceBytes, { headers: { "content-type": "application/pdf" } });
    if (request.headers.get("authorization") !== "Bearer sk_test_fixture")
      return Response.json({ error: "invalid_api_key" }, { status: 401 });
    if (request.headers.get("stripe-version") !== apiVersion && path !== "/v1/account")
      return Response.json({ error: "api_version_required" }, { status: 400 });
    const body = await request.text();
    const fields = Object.fromEntries(new URLSearchParams(body));
    calls.push({ path, fields });
    const key = request.headers.get("idempotency-key");
    const prior = key ? receipts.get(key) : null;
    if (prior) return prior.body === `${path}:${body}` ? Response.json(prior.response)
      : Response.json({ error: "idempotency_error" }, { status: 400 });
    let response: unknown;
    if (path === "/v1/account") response = { id: "acct_fixture" };
    else if (path.startsWith("/v1/prices/")) {
      const id = path.slice("/v1/prices/".length);
      const found = prices.get(id);
      if (!found) return Response.json({ error: "resource_missing" }, { status: 404 });
      response = found;
    } else if (path === "/v1/customers") {
      z.email().parse(fields["email"]);
      organization = z.uuid().parse(fields["metadata[quire_organization]"]);
      response = { id: "cus_fixture" };
    } else if (path === "/v1/invoices/create_preview") {
      if (fields["customer"] !== "cus_fixture" || fields["subscription_details[proration_behavior]"] !== "always_invoice")
        return Response.json({ error: "invalid_preview" }, { status: 400 });
      const selected = prices.get(fields["subscription_details[items][0][price]"] ?? "");
      if (!selected) return Response.json({ error: "price_missing" }, { status: 404 });
      if (fields["subscription"] && (fields["subscription"] !== "sub_fixture" ||
        fields["subscription_details[items][0][id]"] !== "si_fixture" ||
        !fields["subscription_details[proration_date]"])) return Response.json({ error: "invalid_proration" }, { status: 400 });
      response = { amount_due: selected.unit_amount * Number(fields["subscription_details[items][0][quantity]"]), currency: "usd" };
    } else if (path === "/v1/customers/cus_fixture") {
      if (!key || request.method !== "POST") return Response.json({ error: "invalid_customer_update" }, { status: 400 });
      z.email().parse(fields["email"]);
      z.string().parse(fields["address[line1]"]);
      response = { id: "cus_fixture" };
    } else if (path === "/v1/checkout/sessions" && request.method === "POST") {
      if (!key || fields["mode"] !== "subscription" || fields["customer"] !== "cus_fixture" ||
        fields["subscription_data[metadata][quire_organization]"] !== organization ||
        !fields["success_url"] || !fields["cancel_url"]) return Response.json({ error: "invalid_checkout" }, { status: 400 });
      quantity = Number(fields["line_items[0][quantity]"]);
      price = fields["line_items[0][price]"] ?? "";
      response = { id: "cs_fixture", url: "https://checkout.stripe.com/c/pay/cs_fixture", expires_at: Number(fields["expires_at"]) };
    } else if (path === "/v1/checkout/sessions/cs_fixture" && complete) {
      response = { id: "cs_fixture", customer: "cus_fixture", subscription: "sub_fixture",
        client_reference_id: organization, status: "complete" };
    } else if (path === "/v1/subscriptions/sub_fixture") {
      if (request.method === "POST") {
        if (!key) return Response.json({ error: "key_required" }, { status: 400 });
        if (fields["cancel_at_period_end"] === "true") cancelAtPeriodEnd = true;
        else {
          if (fields["items[0][id]"] !== "si_fixture" || fields["payment_behavior"] !== "pending_if_incomplete" ||
            fields["proration_behavior"] !== "always_invoice" || !fields["proration_date"])
            return Response.json({ error: "invalid_update" }, { status: 400 });
          price = fields["items[0][price]"] ?? "";
          quantity = Number(fields["items[0][quantity]"]);
        }
      } else if (request.method === "DELETE") state = "canceled";
      response = subscription();
      if (request.method === "GET" && barrier) {
        const held = barrier;
        barrier = null;
        held.arrived();
        await held.release;
      }
    } else if (path === "/v1/invoices/in_fixture") {
      response = { id: "in_fixture", customer: "cus_fixture", amount_due: 3000, currency: "usd",
        status: "paid", created: 1793102400, invoice_pdf: `${server.url.origin}/invoice.pdf` };
    } else if (path === "/v1/billing_portal/sessions") {
      if (fields["customer"] !== "cus_fixture" || fields["configuration"] !== "bpc_fixture" || !key)
        return Response.json({ error: "invalid_portal" }, { status: 400 });
      response = { url: "https://billing.stripe.com/p/session/fixture" };
    } else return Response.json({ error: "resource_missing" }, { status: 404 });
    if (key) receipts.set(key, { body: `${path}:${body}`, response });
    if (path === "/v1/checkout/sessions" && failedCheckout)
      return Response.json({ error: "connection_uncertain_after_creation" }, { status: 503 });
    return Response.json(response);
  } });
  return {
    origin: server.url.origin, calls, subscription, complete: () => { complete = true; },
    setSeats: (seats: number) => { quantity = seats; }, failCheckout: () => { failedCheckout = true; },
    setStatus: (status: "active" | "past_due" | "canceled") => { state = status; },
    holdSubscription() {
      const arrival = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      barrier = { arrived: () => arrival.resolve(), release: gate.promise };
      return { arrived: arrival.promise, release: () => gate.resolve() };
    },
    event(id: string, type = "customer.subscription.updated", created = 1793102400) {
      const object = type.startsWith("invoice.") ? { id: "in_fixture", customer: "cus_fixture" }
        : type === "checkout.session.completed" ? { id: "cs_fixture" } : subscription();
      return JSON.stringify({ id, type, created, data: { object } });
    },
    sign(bytes: string, now: string, secret = "whsec_fixture") {
      const timestamp = Math.floor(Date.parse(now) / 1000);
      return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${bytes}`).digest("hex")}`;
    },
    async [Symbol.asyncDispose]() { await server.stop(true); },
  };
}
