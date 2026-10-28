import { expect } from "bun:test";
import { access } from "node:fs/promises";
import { z } from "zod";
import { connectionApplication } from "../../../ui-integrations/application";
import { configure, contextFor, responseData } from "../../../ui-integrations/helpers";
import { stripeFixture } from "../../../adapters/billing/provider";
import { fixtureCertificate, fixtureKey } from "../../../adapters/delivery/tls-material";
import { SafeHttpClient } from "../../../../services/adapters/shared";
import { endpoints } from "@quire/contracts";
import { fixtureIds } from "../../../fixtures/foundation";
import type { Browser } from "@playwright/test";

/** Only the provider's hosted destination differs from the canonical Stripe protocol fixture. */
export async function checkoutApplication(options: { readonly configured?: boolean; readonly unsafeDestination?: boolean } = {}) {
  const resources = new AsyncDisposableStack();
  try {
    const provider = resources.use(stripeFixture());
    const landings: string[] = [];
    let returnUrl = "";
    const landing = Bun.serve({
      hostname: "127.0.0.1", port: 0, tls: { key: fixtureKey, cert: fixtureCertificate },
      fetch(request) {
        landings.push(request.url);
        console.info("CHECKOUT_HOSTED_HTTP", { method: request.method, url: request.url });
        if (new URL(request.url).pathname !== "/checkout/cs_fixture") return new Response("Not found", { status: 404 });
        return new Response(`<!doctype html><html lang="en"><title>Local hosted checkout</title><h1>Hosted checkout fixture</h1><p>No payment has been made.</p><a href="${returnUrl}">Return to billing without payment</a></html>`,
          { headers: { "content-type": "text/html" } });
      },
    });
    resources.defer(async () => { await landing.stop(true); });
    const destination = new URL("/checkout/cs_fixture?session=opaque-fixture", landing.url).href;
    const bridge = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "GET" ? undefined : await request.text();
        const response = await fetch(new URL(url.pathname + url.search, provider.origin), {
          method: request.method, headers: request.headers, ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(10_000),
        });
        console.info("CHECKOUT_PROVIDER_HTTP", { method: request.method, path: url.pathname, status: response.status });
        if (url.pathname !== "/v1/checkout/sessions" || request.method !== "POST" || !response.ok) return response;
        returnUrl = new URLSearchParams(body).get("success_url") ?? "";
        const session = z.object({ id: z.string(), url: z.string(), expires_at: z.number() }).parse(await response.json());
        return Response.json({ ...session, url: options.unsafeDestination ? destination.replace("https:", "http:") : destination });
      },
    });
    resources.defer(async () => { await bridge.stop(true); });
    const app = resources.use(await connectionApplication({
      http: new SafeHttpClient({ fixtureOrigins: [bridge.url.origin] }),
    }));
    const owner = await app.login();
    if (options.configured !== false) {
      const operator = await app.login("operator@quire.local");
      await configure(app, operator, {
        kind: "stripe-billing", baseUrl: bridge.url.origin,
        secret: JSON.stringify({ apiKey: "sk_test_fixture", webhookSecrets: ["whsec_fixture"], portalConfiguration: "bpc_fixture",
          prices: [{ id: "price_month", name: "Monthly fixture" }, { id: "price_year", name: "Annual fixture" }] }),
      });
    }
    const path = `/api/organizations/${fixtureIds.team}/billing`;
    const owned = resources.move();
    return {
      app, owner, provider, path, destination, landings,
      async context(browser: Browser, width = 1440) {
        const context = await contextFor(browser, { app, session: owner }, {
          viewport: { width, height: width === 390 ? 844 : 1000 }, ignoreHTTPSErrors: true,
        });
        // Browser egress is loopback-only even if the UI regresses to a static provider URL.
        await context.route("**/*", async route => {
          const host = new URL(route.request().url()).hostname;
          if (host === "127.0.0.1" || host === "localhost") await route.continue();
          else { console.info("CHECKOUT_BLOCKED_EGRESS", route.request().url()); await route.abort("blockedbyclient"); }
        });
        return context;
      },
      async account() {
        const response = await fetch(new URL(path, app.url), { headers: owner.headers, signal: AbortSignal.timeout(10_000) });
        expect(response.status).toBe(200);
        return responseData(response, endpoints.billingGet.output);
      },
      async webhook(id: string) {
        const bytes = provider.event(id);
        const response = await fetch(new URL("/api/webhooks/billing/stripe", app.url), {
          method: "POST", body: bytes, headers: { "content-type": "application/json",
            "stripe-signature": provider.sign(bytes, app.application.runtime.clock.now()) }, signal: AbortSignal.timeout(10_000),
        });
        console.info("CHECKOUT_SIGNED_WEBHOOK", { id, status: response.status });
        expect(response.status).toBe(200);
      },
      async [Symbol.asyncDispose]() {
        await owned.disposeAsync();
        console.info("CHECKOUT_RESOURCES_CLOSED", {
          dataDir: app.dataDir, web: app.url.origin, api: app.apiUrl.origin,
          merchantBridge: bridge.url.origin, provider: provider.origin, hosted: landing.url.origin,
          dataDirExists: await access(app.dataDir).then(() => true, () => false),
        });
      },
    };
  } finally { await resources.disposeAsync(); }
}
