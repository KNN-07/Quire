import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { FederationConfigurations, emptyConfig } from "../../../../services/adapters/federation";
import { ldapFixture } from "../../../adapters/federation/ldap-fixture";
import { fixtureIds } from "../../../fixtures/foundation";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";

test("identity administration tests real LDAP user credentials without saving them or provisioning an account", async () => {
  const evidence = `docs/evidence/p27-admin-ldap/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using directory = await ldapFixture();
    const deployment = { organizationId: fixtureIds.institution, ldapAllowedUrls: [directory.url], ldapSubjectAttribute: "entryUUID" };
    await using app = await connectionApplication({ federation: deployment });
    root = app.dataDir;
    const configurations = new FederationConfigurations({
      ...app.application.runtime, routes: app.application.runtime.routes.forLane("A"),
    }, deployment);
    const original = await configurations.get();
    await app.application.runtime.uow.run(tx => configurations.save(tx, {
      config: { ...emptyConfig, version: original.config.version, protocol: "ldap", enabled: true,
        createOnLogin: true, breakGlassUserId: fixtureIds.operator, domains: ["example.test"],
        attributes: { email: "mail", name: "cn", groups: "description" },
        ldap: { url: directory.url, baseDn: "dc=example,dc=test", bindDn: "cn=admin,dc=example,dc=test",
          userFilter: "(uid={username})", caCertificate: directory.cert, secretPresent: true } },
      ldapSecret: "fixture-admin-password", oidcSecret: null,
    }));
    console.info("ADMIN_LDAP_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin,
      directory: directory.url, container: directory.name, evidence });
    await using browser = await startEditorBrowser();
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    const page = await operator.context.newPage();
    await page.goto("/admin/identity", { waitUntil: "domcontentloaded" });
    const username = page.getByLabel("Test username", { exact: true });
    const password = page.getByLabel("Test user password", { exact: true });
    const testButton = page.getByRole("button", { name: "Test connection", exact: true });
    await username.waitFor();
    expect(await testButton.isDisabled()).toBe(true);
    await username.fill("researcher");
    await password.fill("wrong-test-password");
    const failedRequest = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.identityTest.path);
    await testButton.click();
    const denied = await failedRequest;
    expect(denied.status()).toBe(401);
    expect(await denied.json()).toMatchObject({ error: { code: "LDAP_CREDENTIALS_INVALID" } });
    await waitForRenderedText(page, "LDAP_CREDENTIALS_INVALID");
    expect(await password.inputValue()).toBe("");
    expect(await testButton.isDisabled()).toBe(true);
    expect((await configurations.get()).config.version).toBe(1);
    await password.fill("correct-directory-password");
    const testRequest = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.identityTest.path);
    await testButton.click();
    const response = await testRequest;
    expect(response.status()).toBe(202);
    const result = resultSchema(endpoints.identityTest.output).parse(await response.json());
    if (!("data" in result)) throw new Error(result.error.code);
    expect(result.data.status).toBe("succeeded");
    expect(result.data.result).toMatchObject({ verified: true, operatorOnly: true });
    await waitForRenderedText(page, result.data.id);
    expect(await password.inputValue()).toBe("");
    expect(await app.application.runtime.db.get("SELECT id FROM users WHERE primary_email='directory@example.test'")).toBeNull();
    expect((await configurations.get()).config.version).toBe(1);
    expect(JSON.stringify(await app.application.runtime.db.all("SELECT config_json FROM federation_tests"))).not.toContain("correct-directory-password");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/verified-${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    await page.getByRole("button", { name: "Save identity", exact: true }).click();
    const saved = page.waitForResponse(entry => new URL(entry.url()).pathname === endpoints.identityConfigPut.path &&
      entry.request().method() === "PUT");
    await page.getByRole("button", { name: "Confirm identity save", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await waitForRenderedText(page, "Identity configuration saved by the server.");
    expect((await configurations.get()).config.version).toBe(2);
    expect(await username.inputValue()).toBe("");
    expect(await password.inputValue()).toBe("");
    const me = resultSchema(endpoints.me.output).parse(await (await operator.context.request.get("/api/me")).json());
    if (!("data" in me)) throw new Error(me.error.code);
    expect(me.data.user.id).toBe(fixtureIds.operator);
    console.info("ADMIN_LDAP_VERIFIED", { operationId: result.data.id, wrongStatus: denied.status(),
      verified: result.data.result, savedVersion: 2, accountProvisioned: false });
    await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("ADMIN_LDAP_CLOSED", { root, evidence });
}, 180_000);
