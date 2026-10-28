import { expect, test } from "bun:test";
import type { Route } from "@playwright/test";
import { endpoints } from "@quire/contracts";
import { connectionApplication } from "./application";
import { SafeHttpClient } from "../../services/adapters/shared";
import { dropboxProvider } from "./dropbox-provider";
import { capture, changed, completeOAuth, configure, contextFor, responseData, waitForRenderedText } from "./helpers";
import { bounded } from "../integration/portable/process";
import { startEditorBrowser } from "../ui-editor/shared/browser";

test("persists scoped Dropbox policy and repeat-sync operations through the actual account UI", async () => {
  // Given actual same-origin account/core/shared/Dropbox modules and an owned OAuth/v2 provider.
  await using provider = dropboxProvider();
  await using app = await connectionApplication({
    http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }),
    dropbox: { appKey: "quire-app", appFolder: "Apps/Quire", endpoints: provider.endpoints },
  });
  const owner = await app.login(), operator = await app.login("operator@quire.local");
  await configure(app, operator, { kind: "dropbox", baseUrl: provider.origin, secret: "dropbox-client-secret" });
  await using ownedBrowser = await startEditorBrowser();
  const browser = ownedBrowser.browser;
  const consoleErrors: string[] = [], pageErrors: string[] = [];
  try {
    const context = await contextFor(browser, { app, session: owner });
    try {
      const page = await context.newPage();
      page.on("console", entry => { if (entry.type() === "error") consoleErrors.push(entry.text()); });
      page.on("pageerror", error => pageErrors.push(error.message));
      const projects = await responseData(await context.request.get("/api/projects"), endpoints.projectList.output);
      const organizations = await responseData(await context.request.get("/api/organizations"), endpoints.organizationsList.output);
      const project = projects.items.find(entry => entry.ownerId === owner.user.id);
      const organization = organizations.items.find(entry => entry.id === project?.workspaceId);
      if (!project || !organization) throw new TypeError("Accessible owned project and its organization required");
      const projectPath = `/api/dropbox/policies/project/${project.id}`;
      const organizationPath = `/api/dropbox/policies/organization/${organization.id}`;
      const headers = { origin: app.url.origin, "x-csrf-token": owner.account.csrfToken };
      await page.goto("/settings/git");
      await waitForRenderedText(page, "Dropbox policy & sync");
      expect((await completeOAuth(page, { id: "dropbox", label: "Dropbox" })).status()).toBe(303);
      await waitForRenderedText(page, "Test Dropbox");
      await page.getByLabel("Dropbox policy scope", { exact: true }).selectOption(`organization:${organization.id}`);
      await waitForRenderedText(page, "Effective access: Allowed");
      await page.getByLabel("Allow Dropbox for this organization", { exact: true }).uncheck();
      const denied = await changed(page, organizationPath, () => page.getByRole("button", { name: "Save Dropbox policy", exact: true }).click());
      expect((await responseData(denied, endpoints.dropboxPolicyPut.output)).effectiveEnabled).toBe(false);
      await page.getByLabel("Dropbox policy scope", { exact: true }).selectOption(`project:${project.id}`);
      await waitForRenderedText(page, "Effective access: Denied");
      expect(await page.getByRole("button", { name: "Start project sync", exact: true }).isDisabled()).toBe(true);
      await page.reload();
      await waitForRenderedText(page, "Effective access: Denied");
      expect(await page.getByLabel("Dropbox policy scope", { exact: true }).inputValue()).toBe(`project:${project.id}`);
      // A second writer advances the policy after the UI read; the stale form cannot overwrite it.
      expect((await context.request.put(projectPath, { headers, data: { enabled: false, expectedVersion: 0 } })).status()).toBe(200);
      await page.getByLabel("Allow Dropbox for this project", { exact: true }).uncheck();
      const stale = await changed(page, projectPath, () => page.getByRole("button", { name: "Save Dropbox policy", exact: true }).click());
      expect(stale.status()).toBe(409);
      await waitForRenderedText(page, "Dropbox policy changed");
      await capture(page, "dropbox-policy-denied-stale-1440-light");
      await page.getByRole("button", { name: "Reload policy", exact: true }).click();
      await waitForRenderedText(page, "Policy version 1");
      await page.getByLabel("Allow Dropbox for this project", { exact: true }).check();
      expect((await changed(page, projectPath, () => page.getByRole("button", { name: "Save Dropbox policy", exact: true }).click())).ok()).toBe(true);
      // When the administrator permits the organization, then starts and repeats real project sync.
      await page.getByLabel("Dropbox policy scope", { exact: true }).selectOption(`organization:${organization.id}`);
      await waitForRenderedText(page, "Effective access: Denied");
      await page.getByLabel("Allow Dropbox for this organization", { exact: true }).check();
      expect((await changed(page, organizationPath, () => page.getByRole("button", { name: "Save Dropbox policy", exact: true }).click())).ok()).toBe(true);
      await page.getByLabel("Dropbox policy scope", { exact: true }).selectOption(`project:${project.id}`);
      await waitForRenderedText(page, "Effective access: Allowed");
      const grants = await responseData(await context.request.get("/api/connections"), endpoints.connectionsList.output);
      const grant = grants.items.find(entry => entry.provider === "dropbox");
      if (!grant) throw new TypeError("OAuth grant required");
      const actionPath = `/api/connections/${grant.id}/actions`;
      const initial = await changed(page, actionPath, () => page.getByRole("button", { name: "Start project sync", exact: true }).click());
      const operation = await responseData(initial, endpoints.connectionAction.output);
      expect(operation.status).toBe("succeeded");
      await waitForRenderedText(page, "Synchronization completed.");
      expect(provider.files.size).toBeGreaterThan(0);
      await page.reload();
      await waitForRenderedText(page, operation.id);
      // Hold the real outgoing action while a second authorized HTTP writer advances its cursor.
      const intercepted = Promise.withResolvers<Route>();
      await page.route(`**${actionPath}`, route => { intercepted.resolve(route); });
      await page.getByRole("button", { name: "Sync project now", exact: true }).click();
      const outgoing = await bounded(intercepted.promise, 30000);
      const competingCursor = await responseData(await context.request.get(`/api/connections/${grant.id}/cursor`, {
        params: { action: "sync", projectId: project.id },
      }), endpoints.connectionCursor.output);
      const competing = await context.request.post(actionPath, { headers: { ...headers, "idempotency-key": crypto.randomUUID() },
        data: { action: "sync", projectId: project.id, parameters: { generatedOutput: false },
          expectedVersion: competingCursor.grantVersion, expectedCursor: competingCursor.cursor },
      });
      expect((await responseData(competing, endpoints.connectionAction.output)).status).toBe("succeeded");
      const providerCalls = provider.requests.length;
      const conflicted = page.waitForResponse(entry => new URL(entry.url()).pathname === actionPath && entry.request().method() === "POST");
      const refreshed = page.waitForResponse(entry => new URL(entry.url()).pathname === `/api/connections/${grant.id}/cursor`);
      await outgoing.continue();
      expect((await conflicted).status()).toBe(409);
      expect((await refreshed).ok()).toBe(true);
      await waitForRenderedText(page, "Current connection state refreshed");
      expect(provider.requests.length).toBe(providerCalls);
      await capture(page, "dropbox-cursor-conflict-1440-light");
      await page.unroute(`**${actionPath}`);
      const cursorRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/connections/${grant.id}/cursor`);
      const repeated = await changed(page, actionPath, () => page.getByRole("button", { name: "Sync project now", exact: true }).click());
      expect((await cursorRead).ok()).toBe(true);
      expect((await responseData(repeated, endpoints.connectionAction.output)).status).toBe("succeeded");
      await waitForRenderedText(page, "Synchronization completed.");
      const repeatAfterReload = await changed(page, actionPath, () => page.getByRole("button", { name: "Sync project now", exact: true }).click());
      const latest = await responseData(repeatAfterReload, endpoints.connectionAction.output);
      expect(latest.status).toBe("succeeded");
      // Then durable results render without secret disclosure, and source is actually present upstream.
      for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"] as const) {
        const captured = await contextFor(browser, { app, session: owner }, {
          viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme,
          isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
        });
        try {
          await captured.addInitScript(({ scopeId, operationId, userId }) => {
            localStorage.setItem(`quire:dropbox:scope:${userId}`, `project:${scopeId}`);
            localStorage.setItem(`quire:dropbox:operation:${scopeId}`, operationId);
          }, { scopeId: project.id, operationId: latest.id, userId: owner.user.id });
          const visible = await captured.newPage();
          await visible.goto("/settings/git");
          await waitForRenderedText(visible, latest.id);
          await waitForRenderedText(visible, "Test Dropbox");
          if (width === 390) {
            const labels = visible.locator(".connection-grants .account-row>span:first-child");
            expect(await labels.count()).toBeGreaterThan(0);
            expect(await labels.evaluateAll(nodes => nodes.every(node => node.parentElement !== null
              && node.getBoundingClientRect().width >= node.parentElement.getBoundingClientRect().width * 0.8))).toBe(true);
          }
          await capture(visible, `dropbox-synced-${width}-${colorScheme}`);
        } finally { await captured.close(); }
      }
      expect((await changed(page, actionPath, () => page.getByRole("button", { name: "Disconnect project sync", exact: true }).click())).ok()).toBe(true);
      await waitForRenderedText(page, "Project synchronization disconnected.");
      expect(await page.getByRole("button", { name: "Test Dropbox", exact: true }).isDisabled()).toBe(false);
      const missingCsrf = await context.request.put(projectPath, { headers: { origin: app.url.origin }, data: { enabled: false, expectedVersion: 2 } });
      expect(missingCsrf.status()).toBe(403);
      const foreign = await app.login("mai@quire.local");
      const foreignContext = await contextFor(browser, { app, session: foreign });
      try {
        expect((await foreignContext.request.get(projectPath)).status()).toBe(403);
        expect((await foreignContext.request.put(organizationPath, { headers: { origin: app.url.origin, "x-csrf-token": foreign.account.csrfToken }, data: { enabled: true, expectedVersion: 2 } })).status()).toBe(403);
      } finally { await foreignContext.close(); }
      expect(pageErrors).toEqual([]);
    } catch (error) {
      const page = context.pages()[0];
      if (page) { await capture(page, "dropbox-failed-frame"); console.info("DROPBOX_FAILURE_TEXT", await page.locator("body").innerText()); }
      throw error;
    } finally { await context.close(); }
  } finally {
    console.info("DROPBOX_BROWSER_ERRORS", { consoleErrors, pageErrors });
  }
}, 300000);
