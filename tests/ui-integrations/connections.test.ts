import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser } from "@playwright/test";
import { endpoints, ErrorResultSchema } from "@quire/contracts";
import { connectionApplication } from "./application";
import { SafeHttpClient } from "../../services/adapters/shared";
import { githubFixture } from "../adapters/remote-git/provider-fixture";
import { referenceProvider, zoteroKey } from "../adapters/references/provider";
import { dropboxProvider } from "./dropbox-provider";
import { capture, changed, completeOAuth, configure, contextFor, responseData, waitForRenderedText } from "./helpers";
import type { Application, Session } from "./helpers";
import { startEditorBrowser } from "../ui-editor/shared/browser";

describe("actual account connection workflows", () => {
  const resources = new AsyncDisposableStack();
  let app: Application, owner: Session, browser: Browser;
  let github: Awaited<ReturnType<typeof githubFixture>>;
  let reference: ReturnType<typeof referenceProvider>;
  let dropbox: ReturnType<typeof dropboxProvider>;
  const consoleErrors: string[] = [], pageErrors: string[] = [];
  beforeAll(async () => {
    try {
      github = resources.use(await githubFixture());
      reference = resources.use(referenceProvider());
      dropbox = resources.use(dropboxProvider());
      app = resources.use(await connectionApplication({
        http: new SafeHttpClient({ fixtureOrigins: [github.origin, reference.origin, dropbox.origin] }),
        remoteGit: { fixtureOrigins: [github.origin] },
        dropbox: { appKey: "quire-app", appFolder: "Apps/Quire", endpoints: dropbox.endpoints },
      }));
      owner = await app.login();
      const operator = await app.login("operator@quire.local");
      await configure(app, operator, { kind: "zotero", baseUrl: reference.origin });
      await configure(app, operator, { kind: "github", baseUrl: github.origin, model: "remote-git-github-client", secret: "remote-git-github-secret" });
      await configure(app, operator, { kind: "git", baseUrl: github.origin });
      await configure(app, operator, { kind: "dropbox", baseUrl: dropbox.origin, secret: "dropbox-client-secret" });
      browser = resources.use(await startEditorBrowser()).browser;
      browser.on("context", context => {
        context.on("page", page => {
          page.on("console", entry => { if (entry.type() === "error") consoleErrors.push(entry.text()); });
          page.on("pageerror", error => pageErrors.push(error.message));
        });
      });
    } catch (error) { await resources.disposeAsync(); throw error; }
  }, 300000);
  afterAll(async () => {
    console.info("CONNECTIONS_BROWSER_ERRORS", { consoleErrors, pageErrors });
    await resources.disposeAsync();
  }, 30000);

  test("admits validated Zotero keys without persisting plaintext in the UI", async () => {
    // Given the actual reference provider, with valid and invalid key responses.
    const context = await contextFor(browser, { app, session: owner });
    try {
      const page = await context.newPage();
      await page.goto("/settings/git");
      await waitForRenderedText(page, "Configured");
      const before = (await responseData(await context.request.get("/api/connections"), endpoints.connectionsList.output)).items.length;
      await page.getByRole("button", { name: "Connect Zotero", exact: true }).click();
      await page.getByLabel("Connection label", { exact: true }).fill("Research bibliography");
      const secret = page.getByLabel("Zotero access token", { exact: true });
      expect(await secret.getAttribute("type")).toBe("password");
      expect(await secret.getAttribute("autocomplete")).toBe("new-password");
      await secret.fill("invalid-key");
      const rejected = await changed(page, "/api/connections/zotero/credentials", () => page.getByRole("button", { name: "Save connection", exact: true }).click());
      expect(rejected.ok()).toBe(false);
      await waitForRenderedText(page, "Provider credential is missing, expired or revoked");
      await capture(page, "zotero-invalid-1440-light");
      expect((await responseData(await context.request.get("/api/connections"), endpoints.connectionsList.output)).items).toHaveLength(before);
      // When the valid dedicated key is admitted over real authenticated HTTP.
      await secret.fill(zoteroKey);
      const saved = await changed(page, "/api/connections/zotero/credentials", () => page.getByRole("button", { name: "Save connection", exact: true }).click());
      const grant = await responseData(saved, endpoints.connectionCredentials.output);
      // Then only the validated grant survives a reload and no submitted key is echoed.
      await waitForRenderedText(page, "Connection saved.");
      expect(await secret.inputValue()).toBe("");
      expect((await saved.text()).includes(zoteroKey)).toBe(false);
      await page.reload();
      await waitForRenderedText(page, "Research bibliography");
      expect(await page.locator("body").innerText()).not.toContain(zoteroKey);
      expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage)))).not.toContain(zoteroKey);
      const tested = await changed(page, `/api/connections/${grant.id}/test`, () => page.getByRole("button", { name: "Test Research bibliography", exact: true }).click());
      expect(tested.ok()).toBe(true);
      await waitForRenderedText(page, "connection test passed.");
      await capture(page, "zotero-saved-1440-light");
      const denied = await context.request.post("/api/connections/zotero/credentials", { headers: { origin: app.url.origin }, data: { accessToken: zoteroKey, label: "No CSRF" } });
      expect(denied.status()).toBe(403);
    } finally { await context.close(); }
    expect(pageErrors).toEqual([]);
  }, 120000);

  test("completes OAuth redirect and manages repository-bound Git credentials locally", async () => {
    // Given a configured actual GitHub OAuth and authenticated smart Git provider.
    const context = await contextFor(browser, { app, session: owner });
    try {
      const page = await context.newPage();
      await page.goto("/settings/git");
      await waitForRenderedText(page, "Saved connections");
      // When the user completes real state/PKCE OAuth, then verifies a repository credential.
      expect((await completeOAuth(page, { id: "github", label: "GitHub" })).status()).toBe(303);
      await waitForRenderedText(page, "Test GitHub");
      const token = github.tokens.at(-1);
      if (!token) throw new TypeError("OAuth must issue a real fixture credential");
      await page.getByRole("button", { name: "Connect Generic Git", exact: true }).click();
      await page.getByLabel("Connection label", { exact: true }).fill("Bound repository");
      await page.getByLabel("Repository URL", { exact: true }).fill(`${github.origin}/owner/research.git`);
      await page.getByLabel("Repository username", { exact: true }).fill("git");
      await page.getByLabel("Repository secret", { exact: true }).fill(token);
      const response = await changed(page, "/api/connections/git/credentials", () => page.getByRole("button", { name: "Save connection", exact: true }).click());
      const grant = await responseData(response, endpoints.gitCredentials.output);
      await waitForRenderedText(page, "Connection saved.");
      expect(await page.getByLabel("Repository secret", { exact: true }).inputValue()).toBe("");
      await page.reload();
      await waitForRenderedText(page, "Bound repository");
      const current = await responseData(await context.request.get(`/api/connections/${grant.id}/cursor`, { params: { action: "clone" } }), endpoints.connectionCursor.output);
      const mismatched = await context.request.post(`/api/connections/${grant.id}/actions`, {
        headers: { origin: app.url.origin, "x-csrf-token": owner.account.csrfToken, "idempotency-key": crypto.randomUUID() },
        data: { action: "clone", parameters: { name: "Denied repository", url: `${github.origin}/other/repo.git`, branch: "main" },
          expectedCursor: current.cursor, expectedVersion: current.grantVersion },
      });
      expect(mismatched.status()).toBe(403);
      expect(ErrorResultSchema.parse(await mismatched.json()).error.code).toBe("GIT_CREDENTIAL_SCOPE");
      const tested = await changed(page, `/api/connections/${grant.id}/test`, () => page.getByRole("button", { name: "Test Bound repository", exact: true }).click());
      console.info("GENERIC_CONNECTION_TEST", { status: tested.status(), body: await tested.text() });
      expect(tested.status()).toBe(200);
      await waitForRenderedText(page, "connection test passed.");
      await page.getByRole("button", { name: "Forget Bound repository", exact: true }).click();
      await capture(page, "generic-removal-1440-light");
      const removed = await changed(page, `/api/connections/${grant.id}`, () => page.getByRole("button", { name: "Forget saved credential", exact: true }).click());
      expect(removed.ok()).toBe(true);
      // Then Quire forgets locally without falsely revoking an independently managed token.
      await waitForRenderedText(page, "Upstream credential was not revoked.");
      expect(github.tokens.includes(token)).toBe(true);
      const row = await app.application.runtime.db.get<{ encrypted_secret: Uint8Array | null; state: string }>("SELECT encrypted_secret,state FROM provider_grants WHERE id=?", [grant.id]);
      expect(row).toMatchObject({ encrypted_secret: null, state: "disabled" });
      expect(await page.locator("body").innerText()).not.toContain(token);
      await page.getByRole("button", { name: "Disconnect GitHub", exact: true }).click();
      const revoked = page.waitForResponse(entry => new URL(entry.url()).pathname.startsWith("/api/connections/") && entry.request().method() === "DELETE");
      await page.getByRole("button", { name: "Confirm disconnect", exact: true }).click();
      expect((await revoked).ok()).toBe(true);
      await waitForRenderedText(page, "Connection disconnected.");
      expect(github.tokens.includes(token)).toBe(false);
    } finally { await context.close(); }
    expect(pageErrors).toEqual([]);
  }, 120000);

  test("pages real saved grants without dropping later connections", async () => {
    // Given 21 upstream-validated grants belonging to an isolated account.
    const session = await app.login("outsider@quire.local");
    const context = await contextFor(browser, { app, session });
    try {
      for (let index = 0; index < 21; index++) {
        const response = await context.request.post("/api/connections/zotero/credentials", {
          headers: { origin: app.url.origin, "x-csrf-token": session.account.csrfToken },
          data: { accessToken: zoteroKey, label: `Bibliography ${index}` },
        });
        expect(response.status()).toBe(200);
      }
      const first = await responseData(await context.request.get("/api/connections", { params: { limit: 20 } }), endpoints.connectionsList.output);
      if (!first.nextCursor) throw new TypeError("A real second page is required");
      const second = await responseData(await context.request.get("/api/connections", { params: { limit: 20, cursor: first.nextCursor } }), endpoints.connectionsList.output);
      const last = second.items[0];
      if (!last) throw new TypeError("Second-page grant required");
      const page = await context.newPage();
      await page.goto("/settings/git");
      await waitForRenderedText(page, "Load more connections");
      expect(await page.getByRole("list", { name: "Saved connections" }).locator(":scope > li").count()).toBe(20);
      // When the real next-page cursor is requested through the production button.
      await page.getByRole("button", { name: "Load more connections", exact: true }).click();
      await waitForRenderedText(page, last.label);
      // Then all grants remain visible and the exhausted page control disappears.
      expect(await page.getByRole("list", { name: "Saved connections" }).locator(":scope > li").count()).toBe(21);
      expect(await page.getByRole("button", { name: "Load more connections", exact: true }).count()).toBe(0);
      await capture(page, "connections-paged-1440-light");
    } finally { await context.close(); }
  }, 120000);

  test("keeps credential forms accessible across viewport and theme states", async () => {
    // Given the actual configured account route in every supported capture mode.
    for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"] as const) {
      const context = await contextFor(browser, { app, session: owner }, {
        viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme,
        isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
      });
      try {
        const page = await context.newPage();
        await page.goto("/settings/git");
        await waitForRenderedText(page, "Configured");
        // When each real admission form is opened.
        await page.getByRole("button", { name: "Connect Zotero", exact: true }).click();
        await page.getByLabel("Zotero access token", { exact: true }).focus();
        await capture(page, `zotero-form-${width}-${colorScheme}`);
        await page.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await page.getByRole("button", { name: "Connect Generic Git", exact: true }).click();
        await page.getByLabel("Repository secret", { exact: true }).focus();
        await capture(page, `generic-form-${width}-${colorScheme}`);
        expect(await page.locator(".connection-settings button").evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 44))).toBe(true);
        // Then fields remain masked, keyboard reachable and outside persisted browser storage.
        expect(await page.getByLabel("Repository secret", { exact: true }).getAttribute("type")).toBe("password");
        await context.setOffline(true);
        await waitForRenderedText(page, "You are offline.");
        await capture(page, `connections-offline-${width}-${colorScheme}`);
        await context.setOffline(false);
      } finally { await context.close(); }
    }
    expect(pageErrors).toEqual([]);
  }, 120000);
});
