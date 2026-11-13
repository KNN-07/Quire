import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AdapterGrantSchema } from "@quire/contracts";
import { SafeHttpClient } from "../../services/adapters/shared";
import { publisherProvider } from "../adapters/publisher/provider";
import { defaultPolicy } from "../fixtures/foundation";
import { connectionApplication } from "./application";
import { startEditorBrowser } from "../ui-editor/shared/browser";
import { changed, completeOAuth, contextFor, responseData, waitForRenderedText } from "./helpers";

test("publisher bearer enrollment and local forgetting render at desktop and mobile widths", async () => {
  await using provider = publisherProvider();
  await using app = await connectionApplication({ http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
  await using browser = await startEditorBrowser();
  const operator = await app.login("operator@quire.local");
  const session = await app.login();
  const errors: string[] = [];
  const evidence = process.env["QUIRE_PUBLISHER_EVIDENCE"] ?? join(import.meta.dir, "evidence");
  await mkdir(evidence, { recursive: true });
  const unconfigured = await contextFor(browser.browser, { app, session });
  try {
    const page = await unconfigured.newPage();
    await page.goto("/settings/git");
    await waitForRenderedText(page, "Connect Publisher");
    expect(await page.getByRole("button", { name: "Connect Publisher", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Connect Publisher", exact: true }) })
      .locator("summary").click();
    expect(await page.getByRole("list", { name: "Connection providers" }).innerText()).toContain("publisher destination");
    await page.screenshot({ path: join(evidence, "publisher-unconfigured.png"), fullPage: true });
  } finally { await unconfigured.close(); }
  const configured = await fetch(new URL("/api/admin/providers/publisher", app.url), {
    method: "PUT", headers: { ...operator.headers, origin: app.url.origin,
      "content-type": "application/json", "if-match": '"0"' },
    body: JSON.stringify({ baseUrl: provider.origin, expectedVersion: 0, policy: defaultPolicy,
      publisherContract: { version: 1, mode: "manual", credentialTestPath: "api/me", authentication: "bearer" } }),
  });
  expect(configured.status).toBe(200);
  for (const width of [1440, 390]) {
    const context = await contextFor(browser.browser, { app, session }, { viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("/settings/git");
      await waitForRenderedText(page, "Connect Publisher");
      await page.getByRole("button", { name: "Connect Publisher", exact: true }).click();
      const form = page.getByRole("form", { name: "Publisher credentials" });
      await form.getByLabel("Connection label").fill(`Publisher ${width}`);
      await form.getByLabel("Publisher access token").fill(provider.issueToken());
      expect(await form.getByLabel("Publisher access token").getAttribute("type")).toBe("password");
      await page.screenshot({ path: join(evidence, `publisher-${width}-enrollment.png`), fullPage: true });
      const saved = await changed(page, "/api/connections/publisher/credentials", () =>
        form.getByRole("button", { name: "Save connection", exact: true }).click());
      expect(saved.status()).toBe(200);
      await waitForRenderedText(page, "Connection saved.");
      expect(await form.getByLabel("Publisher access token").inputValue()).toBe("");
      const grant = await responseData(saved, AdapterGrantSchema);
      const tested = await changed(page, `/api/connections/${grant.id}/test`, () =>
        page.getByRole("button", { name: `Test Publisher ${width}`, exact: true }).click());
      expect(tested.status()).toBe(200);
      await waitForRenderedText(page, "connection test passed.");
      await page.getByRole("button", { name: `Forget Publisher ${width}`, exact: true }).click();
      await waitForRenderedText(page, "The independently managed upstream credential remains valid.");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: join(evidence, `publisher-${width}-forget.png`), fullPage: true });
      const removed = await changed(page, `/api/connections/${grant.id}`, () =>
        page.getByRole("button", { name: "Forget saved credential", exact: true }).click());
      expect(removed.status()).toBe(200);
      await waitForRenderedText(page, "Upstream credential was not revoked.");
      expect(provider.observed.some(path => path.includes("revoke"))).toBe(false);
    } finally { await context.close(); }
  }
  const oauthConfiguration = await fetch(new URL("/api/admin/providers/publisher", app.url), {
    method: "PUT", headers: { ...operator.headers, origin: app.url.origin,
      "content-type": "application/json", "if-match": '"1"' },
    body: JSON.stringify({ baseUrl: provider.origin, expectedVersion: 1, policy: defaultPolicy,
      secret: "publisher-fixture-secret", publisherContract: {
        version: 1, mode: "manual", credentialTestPath: "api/me", oauth: {
          authorizationPath: "oauth/authorize", tokenPath: "oauth/token", revokePath: "oauth/revoke",
          clientId: "publisher-fixture-client", scopes: ["submissions:read", "submissions:write"], tokenAuthentication: "body",
        },
      } }),
  });
  expect(oauthConfiguration.status).toBe(200);
  const oauthContext = await contextFor(browser.browser, { app, session });
  try {
    const page = await oauthContext.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/settings/git");
    await waitForRenderedText(page, "Connect Publisher");
    const callback = await completeOAuth(page, { id: "publisher", label: "Publisher" });
    expect(callback.status()).toBe(303);
    await waitForRenderedText(page, "Configured publisher destination");
    await page.screenshot({ path: join(evidence, "publisher-oauth.png"), fullPage: true });
    const switched = await fetch(new URL("/api/admin/providers/publisher", app.url), {
      method: "PUT", headers: { ...operator.headers, origin: app.url.origin,
        "content-type": "application/json", "if-match": '"2"' },
      body: JSON.stringify({ baseUrl: provider.origin, expectedVersion: 2, policy: defaultPolicy,
        publisherContract: { version: 1, mode: "manual", credentialTestPath: "api/me", authentication: "bearer" } }),
    });
    expect(switched.status).toBe(200);
    await page.getByRole("button", { name: "Reload connections", exact: true }).click();
    await page.getByRole("button", { name: "Connect Publisher", exact: true }).click();
    await waitForRenderedText(page, "Publisher bearer token");
    await page.getByRole("button", { name: "Disconnect Configured publisher destination", exact: true }).click();
    await waitForRenderedText(page, "The adapter must complete provider revocation");
    await page.screenshot({ path: join(evidence, "publisher-oauth-mode-switch.png"), fullPage: true });
  } finally { await oauthContext.close(); }
  expect(errors).toEqual([]);
}, 180000);
