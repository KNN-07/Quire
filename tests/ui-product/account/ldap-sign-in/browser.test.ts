import { expect, test } from "bun:test";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { endpoints, resultSchema } from "@quire/contracts";
import { FederationConfigurations, emptyConfig } from "../../../../services/adapters/federation";
import { SafeHttpClient } from "../../../../services/adapters/shared";
import { ldapFixture } from "../../../adapters/federation/ldap-fixture";
import { providerFixture } from "../../../adapters/identity/provider-fixture";
import { fixtureIds } from "../../../fixtures/foundation";
import { connectionApplication } from "../../../ui-integrations/application";
import { configure } from "../../../ui-integrations/helpers";
import { startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import type { Page } from "@playwright/test";

const evidence = resolve(import.meta.dir, "../../../../docs/evidence/p21-ldap-sign-in");
const exists = (path: string) => access(path).then(() => true, () => false);
const directoryButton = "Continue with Institutional directory";

async function capture(page: Page, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise<void>(painted => requestAnimationFrame(() => painted())));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${width}-${colorScheme}.png`, fullPage: true, animations: "disabled" });
    }
  }
}

test("native configured LDAP form uses real TLS credentials, session refresh and safe returns without changing other providers", async () => {
  await mkdir(evidence, { recursive: true });
  await using resources = new AsyncDisposableStack();
  const directory = resources.use(await ldapFixture());
  const mount = Bun.spawn(["docker", "inspect", "--format",
    '{{range .Mounts}}{{if eq .Destination "/fixture"}}{{.Source}}{{end}}{{end}}', directory.name],
  { stdout: "pipe", stderr: "pipe" });
  const [certificateRoot, mountExit] = await Promise.all([new Response(mount.stdout).text(), mount.exited]);
  expect(mountExit).toBe(0);
  expect(certificateRoot.trim()).toStartWith("/tmp/quire-federation-certificate-");
  const provider = resources.use(await providerFixture());
  provider.state.now = Date.now();
  const deployment = { organizationId: fixtureIds.institution, ldapAllowedUrls: [directory.url], ldapSubjectAttribute: "entryUUID" };
  const app = resources.use(await connectionApplication({
    federation: deployment,
    http: new SafeHttpClient({ fixtureOrigins: [provider.origin], timeoutMs: 5000 }),
    identityProfiles: [{ id: "directory-oidc", label: "LDAP-looking OIDC fixture", issuer: provider.origin,
      protocol: "oidc", pkce: true, scopes: ["openid", "email", "profile"] }],
  }));
  const configurations = new FederationConfigurations({ ...app.application.runtime,
    routes: app.application.runtime.routes.forLane("A") }, deployment);
  async function save(enabled: boolean) {
    const current = await configurations.get();
    await app.application.runtime.uow.run(tx => configurations.save(tx, {
      config: { ...emptyConfig, version: current.config.version, protocol: "ldap", enabled, createOnLogin: true,
        breakGlassUserId: fixtureIds.operator, domains: ["example.test"],
        attributes: { email: "mail", name: "cn", groups: "description" },
        ldap: { url: directory.url, baseDn: "dc=example,dc=test", bindDn: "cn=admin,dc=example,dc=test",
          userFilter: "(uid={username})", caCertificate: directory.cert, secretPresent: true } },
      ldapSecret: "fixture-admin-password", oidcSecret: null,
    }));
  }
  console.info("LDAP_UI_OWNED", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin,
    container: directory.name, directory: directory.url, certificateRoot: certificateRoot.trim(), provider: provider.origin });
  try {
    await using browser = await startEditorBrowser();
    const context = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      const requests: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      page.on("request", request => requests.push(new URL(request.url()).pathname));
      await save(false);
      await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "Federation is disabled");
      expect(await page.getByRole("button", { name: directoryButton, exact: true }).isDisabled()).toBe(true);
      await capture(page, "disabled");

      await save(true);
      await page.goto("/sign-in?returnTo=%2Fsettings%2Fprofile%3Ffrom%3Dldap%23account", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, directoryButton);
      await page.getByRole("button", { name: directoryButton, exact: true }).click();
      expect(await page.getByLabel("Directory username", { exact: true }).count()).toBe(1);
      await capture(page, "credentials");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      expect(await page.getByLabel("Directory username", { exact: true }).count()).toBe(0);
      expect(await page.getByLabel("Email", { exact: true }).isEnabled()).toBe(true);
      await page.getByRole("button", { name: directoryButton, exact: true }).click();
      await page.getByLabel("Directory username", { exact: true }).fill("researcher");
      await page.getByLabel("Directory password", { exact: true }).fill("wrong");
      const wrongResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.ldapLogin.path);
      await page.getByRole("button", { name: "Sign in with directory", exact: true }).click();
      const wrong = await wrongResponse;
      const wrongResult = resultSchema(endpoints.ldapLogin.output).parse(await wrong.json());
      console.info("LDAP_UI_WRONG_RESPONSE", { status: wrong.status(), result: wrongResult });
      expect(wrong.status()).toBe(401);
      if (!("error" in wrongResult)) throw new Error("Wrong LDAP credentials unexpectedly succeeded");
      expect(wrongResult.error.code).toBe("LDAP_CREDENTIALS_INVALID");
      await waitForRenderedText(page, wrongResult.error.message);
      expect(await page.getByRole("alert").innerText()).toBe(wrongResult.error.message);
      expect((await context.request.get("/api/me")).status()).toBe(401);
      await capture(page, "wrong-credentials");
      console.info("LDAP_UI_WRONG", { status: wrong.status(), error: wrongResult.error });

      await page.getByLabel("Directory password", { exact: true }).fill("correct-directory-password");
      const acceptedResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.ldapLogin.path).then(async response => {
        console.info("LDAP_UI_ACCEPTED_RESPONSE", { status: response.status(), result: await response.json() });
        return response;
      });
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/me" && response.status() === 200);
      const returned = page.waitForURL(url => url.pathname === "/settings/profile" && url.search === "?from=ldap" && url.hash === "#account");
      const [accepted] = await Promise.all([acceptedResponse, refreshed, returned,
        page.getByRole("button", { name: "Sign in with directory", exact: true }).click()]);
      expect(accepted.status()).toBe(200);
      expect(accepted.request().method()).toBe("POST");
      const userResult = resultSchema(endpoints.ldapLogin.output).parse(await accepted.json());
      if (!("data" in userResult)) throw new Error("LDAP sign-in failed");
      expect(userResult.data.primaryEmail).toBe("directory@example.test");
      expect(await accepted.headerValue("set-cookie")).toContain("quire_session=");
      const persisted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/me");
      await page.reload({ waitUntil: "domcontentloaded" });
      expect((await persisted).status()).toBe(200);
      await waitForRenderedText(page, "Shown to collaborators");
      expect(await page.getByLabel("Full name", { exact: true }).inputValue()).toBe("Directory Researcher");
      expect(await page.getByLabel("Email", { exact: true }).inputValue()).toBe("directory@example.test");
      await capture(page, "authenticated");
      expect(requests).not.toContain("/api/auth/ldap/start");
      console.info("LDAP_UI_ACCEPTED", { status: accepted.status(), email: userResult.data.primaryEmail,
        returnUrl: page.url(), persistedMe: 200, pageErrors });

      // Fresh browser storage verifies cross-origin returnTo falls back to /projects.
      await context.clearCookies();
      await page.goto("/sign-in?returnTo=https%3A%2F%2Foutside.invalid%2Fsteal", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, directoryButton);
      await page.getByRole("button", { name: directoryButton, exact: true }).click();
      await page.getByLabel("Directory username", { exact: true }).fill("researcher");
      await page.getByLabel("Directory password", { exact: true }).fill("correct-directory-password");
      const safeResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.ldapLogin.path);
      const safeReturn = page.waitForURL(url => url.pathname === "/projects");
      const [safe] = await Promise.all([safeResponse, safeReturn,
        page.getByRole("button", { name: "Sign in with directory", exact: true }).click()]);
      expect(safe.status()).toBe(200);
      expect(safe.request().method()).toBe("POST");
      console.info("LDAP_UI_SAFE_RETURN", page.url());

      await context.clearCookies();
      await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, directoryButton);
      await page.getByRole("button", { name: directoryButton, exact: true }).click();
      await page.getByLabel("Directory username", { exact: true }).fill("researcher");
      await page.getByLabel("Directory password", { exact: true }).fill("correct-directory-password");
      const signupResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.ldapLogin.path);
      const signupReturn = page.waitForURL(url => url.pathname === "/sign-up" && url.search === "?step=start");
      const [signup] = await Promise.all([signupResponse, signupReturn,
        page.getByRole("button", { name: "Sign in with directory", exact: true }).click()]);
      expect(signup.status()).toBe(200);
      expect(signup.request().method()).toBe("POST");
      await waitForRenderedText(page, "What are you writing?");
      console.info("LDAP_UI_SIGNUP_RETURN", page.url());

      await context.clearCookies();
      await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, directoryButton);
      await page.getByLabel("Email", { exact: true }).fill("kien@quire.local");
      await page.getByLabel("Password", { exact: true }).fill(app.password);
      const passwordResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.authLogin.path);
      const passwordReturn = page.waitForURL(url => url.pathname === "/projects");
      const [password] = await Promise.all([passwordResponse, passwordReturn,
        page.getByRole("button", { name: "Sign in", exact: true }).click()]);
      expect(password.status()).toBe(200);
      console.info("LDAP_UI_PASSWORD_BOUNDARY", { status: 200, returnUrl: page.url() });

      const operator = await app.login("operator@quire.local");
      await configure(app, operator, { kind: "identity-directory-oidc", baseUrl: provider.origin,
        secret: JSON.stringify({ clientId: "google-client", clientSecret: "fixture-client-secret" }) });
      await context.clearCookies();
      await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "Continue with LDAP-looking OIDC fixture");
      const oidcStart = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/directory-oidc/start");
      const oidcAuthorization = page.waitForRequest(request => request.url().startsWith(provider.origin + "/authorize?"));
      const oidcCallback = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/directory-oidc/callback");
      const oidcReturned = page.waitForURL(url => url.pathname === "/projects");
      const [oidc, , callback] = await Promise.all([oidcStart, oidcAuthorization, oidcCallback, oidcReturned,
        page.getByRole("button", { name: "Continue with LDAP-looking OIDC fixture", exact: true }).click()]);
      expect(oidc.status()).toBe(302);
      expect(callback.status()).toBe(303);
      console.info("LDAP_UI_OIDC_BOUNDARY", { startStatus: oidc.status(), callbackStatus: callback.status(), provider: "directory-oidc" });

      const current = await configurations.get();
      await app.application.runtime.uow.run(tx => configurations.save(tx, { ...current,
        config: { ...current.config, protocol: "saml", saml: { entityId: provider.origin,
          ssoUrl: provider.origin + "/saml", metadataXml: "", certificates: [directory.cert] } } }));
      await context.clearCookies();
      await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "Continue with Institutional SAML");
      expect(await page.getByRole("button", { name: directoryButton, exact: true }).isDisabled()).toBe(true);
      const samlStart = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/saml/start");
      await page.getByRole("button", { name: "Continue with Institutional SAML", exact: true }).click();
      const saml = await samlStart;
      expect(saml.status()).toBe(302);
      expect(new URL((await saml.headerValue("location")) ?? "").searchParams.has("SAMLRequest")).toBe(true);
      console.info("LDAP_UI_SAML_BOUNDARY", { status: saml.status(), ldapDisabled: true });
      expect(pageErrors).toEqual([]);
    } finally { await context.close(); }
  } finally {
    await resources.disposeAsync();
    expect(await exists(app.dataDir)).toBe(false);
    const container = Bun.spawn(["docker", "inspect", directory.name], { stdout: "pipe", stderr: "pipe" });
    expect(await container.exited).toBe(1);
    expect(await exists(certificateRoot.trim())).toBe(false);
    console.info("LDAP_UI_CLEANED", { root: app.dataDir, rootExists: false, container: directory.name,
      containerInspectExit: 1, certificateRoot: certificateRoot.trim(), certificateRootExists: false,
      browser: "closed", provider: "closed" });
  }
}, 240_000);
