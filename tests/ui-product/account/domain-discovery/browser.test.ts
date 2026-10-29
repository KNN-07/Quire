import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { FederationConfigurations, emptyConfig } from "../../../../services/adapters/federation";
import { SafeHttpClient } from "../../../../services/adapters/shared";
import { providerFixture } from "../../../adapters/federation/oidc-idp";
import { fixtureIds } from "../../../fixtures/foundation";
import { connectionApplication } from "../../../ui-integrations/application";
import { startEditorBrowser } from "../../../ui-editor/shared/browser";

test("organization discovery uses exact domains and current availability before real OIDC login", async () => {
  const evidence = `docs/evidence/p21-domain-discovery/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using provider = await providerFixture();
    const deployment = { organizationId: fixtureIds.institution };
    await using app = await connectionApplication({
      federation: deployment,
      http: new SafeHttpClient({ fixtureOrigins: [provider.origin], timeoutMs: 5000 }),
    });
    root = app.dataDir;
    console.info("DOMAIN_UI_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, provider: provider.origin, evidence });
    const configurations = new FederationConfigurations({
      ...app.application.runtime, routes: app.application.runtime.routes.forLane("A"),
    }, deployment);
    const settings = await configurations.get();
    await app.application.runtime.uow.run(tx => configurations.save(tx, {
      config: { ...emptyConfig, version: settings.config.version, enabled: false, createOnLogin: true,
        domains: ["example.test"], breakGlassUserId: fixtureIds.operator,
        oidc: { issuer: provider.origin, clientId: "domain-client", scopes: ["openid", "email", "profile"], secretPresent: true } },
      oidcSecret: "fixture-client-secret", ldapSecret: null,
    }));
    await using browser = await startEditorBrowser();
    const context = await browser.browser.newContext({ baseURL: app.url.origin });
    try {
      const page = await context.newPage();
      await page.goto("/sign-in?returnTo=%2Fsettings%2Fprofile%3Ffrom%3Dorganization", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Sign in with your organization", exact: true }).click();
      const form = page.getByRole("region", { name: "Organization sign-in", exact: true });
      await form.getByRole("button", { name: "Back", exact: true }).click();
      expect(await form.count()).toBe(0);
      await page.getByRole("button", { name: "Sign in with your organization", exact: true }).click();
      async function discover(domain: string) {
        await form.getByLabel("Organization email domain", { exact: true }).fill(domain);
        const response = page.waitForResponse(entry => new URL(entry.url()).pathname === endpoints.authDiscover.path);
        await form.getByRole("button", { name: "Find organization", exact: true }).click();
        const actual = await response;
        expect(actual.status()).toBe(200);
        const result = resultSchema(endpoints.authDiscover.output).parse(await actual.json());
        if (!("data" in result)) throw new Error(result.error.code);
        return result.data;
      }
      expect((await discover("sub.example.test")).organizations).toEqual([]);
      await form.getByRole("status").waitFor();
      expect((await discover("EXAMPLE.TEST")).organizations[0]?.capability.enabled).toBe(false);
      const organization = form.getByRole("button", { name: "Continue with Quire Institute", exact: true });
      await organization.waitFor();
      expect(await organization.isDisabled()).toBe(true);
      await form.getByLabel("Organization email domain", { exact: true }).fill("different.test");
      expect(await organization.count()).toBe(0);
      const configured = await configurations.get();
      await app.application.runtime.uow.run(tx => configurations.save(tx, {
        ...configured, config: { ...configured.config, enabled: true },
      }));
      expect((await discover("example.test")).organizations[0]?.capability.enabled).toBe(true);
      await organization.waitFor();
      expect(await organization.isEnabled()).toBe(true);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme });
          await page.evaluate(() => document.fonts.ready);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.screenshot({ path: `${evidence}/ready-${width}-${colorScheme}.png`, fullPage: true });
        }
      }
      const callback = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/oidc/callback");
      const destination = page.waitForURL(url => url.pathname === "/settings/profile" && url.search === "?from=organization");
      const [completed] = await Promise.all([callback, destination, organization.click()]);
      expect(completed.status()).toBe(303);
      const profileName = page.getByLabel("Full name", { exact: true });
      await profileName.waitFor();
      expect(await profileName.inputValue()).toBe("External Researcher");
      const me = resultSchema(endpoints.me.output).parse(await (await context.request.get("/api/me")).json());
      if (!("data" in me)) throw new Error(me.error.code);
      expect(me.data.user.primaryEmail).toBe("external@example.test");
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/me");
      await page.reload({ waitUntil: "domcontentloaded" });
      expect((await refreshed).status()).toBe(200);
      expect(provider.observations).toEqual(["token"]);
      console.info("DOMAIN_UI_AUTHENTICATED", { callback: completed.status(), destination: page.url(), email: me.data.user.primaryEmail });
      await page.close();
    } finally { await context.close(); }
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("DOMAIN_UI_CLOSED", { root, evidence });
}, 180_000);
