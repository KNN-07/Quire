import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { FederationConfigurations, emptyConfig } from "../../../../services/adapters/federation";
import { ldapFixture } from "../../../adapters/federation/ldap-fixture";
import { fixtureIds } from "../../../fixtures/foundation";
import { connectionApplication } from "../../../ui-integrations/application";
import { startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";

test("unconfigured LDAP stays disabled and Back removes entered directory credentials", async () => {
  const evidence = `docs/evidence/p21-ldap-back/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using directory = await ldapFixture();
    const deployment = { organizationId: fixtureIds.institution, ldapAllowedUrls: [directory.url], ldapSubjectAttribute: "entryUUID" };
    await using app = await connectionApplication({ federation: deployment });
    root = app.dataDir;
    console.info("LDAP_BACK_OWNED", { root, container: directory.name, web: app.url.origin, api: app.apiUrl.origin, directory: directory.url, evidence });
    const configurations = new FederationConfigurations({
      ...app.application.runtime, routes: app.application.runtime.routes.forLane("A"),
    }, deployment);
    const current = await configurations.get();
    await app.application.runtime.uow.run(tx => configurations.save(tx, {
      config: { ...emptyConfig, version: current.config.version, protocol: "ldap", enabled: true,
        createOnLogin: true, breakGlassUserId: fixtureIds.operator, domains: ["example.test"],
        attributes: { email: "mail", name: "cn", groups: "description" },
        ldap: { url: directory.url, baseDn: "dc=example,dc=test", bindDn: "cn=admin,dc=example,dc=test",
          userFilter: "(uid={username})", caCertificate: directory.cert, secretPresent: false } },
      ldapSecret: null, oidcSecret: null,
    }));
    await using browser = await startEditorBrowser();
    const context = await browser.browser.newContext({ baseURL: app.url.origin });
    try {
      const page = await context.newPage();
      await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "LDAP bind secret");
      const option = page.getByRole("button", { name: "Continue with Institutional directory", exact: true });
      expect(await option.isDisabled()).toBe(true);
      expect(await page.getByLabel("Directory password", { exact: true }).count()).toBe(0);
      const configured = await configurations.get();
      await app.application.runtime.uow.run(tx => configurations.save(tx, {
        ...configured, ldapSecret: "fixture-admin-password",
      }));
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "Continue with Institutional directory");
      await option.click();
      await page.getByLabel("Directory username", { exact: true }).fill("researcher");
      await page.getByLabel("Directory password", { exact: true }).fill("entered-secret-not-submitted");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      expect(await page.getByLabel("Directory password", { exact: true }).count()).toBe(0);
      await option.click();
      expect(await page.getByLabel("Directory username", { exact: true }).inputValue()).toBe("");
      expect(await page.getByLabel("Directory password", { exact: true }).inputValue()).toBe("");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByRole("button", { name: "Sign in with your organization", exact: true }).click();
      await page.getByLabel("Organization email domain", { exact: true }).fill("example.test");
      await page.getByRole("button", { name: "Find organization", exact: true }).click();
      await page.getByRole("button", { name: "Continue with Quire Institute", exact: true }).click();
      expect(await page.getByLabel("Directory password", { exact: true }).inputValue()).toBe("");
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme });
          await page.evaluate(() => document.fonts.ready);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.screenshot({ path: `${evidence}/directory-${width}-${colorScheme}.png`, fullPage: true });
        }
      }
      expect((await context.request.get("/api/me")).status()).toBe(401);
      await page.close();
    } finally { await context.close(); }
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("LDAP_BACK_CLOSED", { root, evidence });
}, 180_000);
