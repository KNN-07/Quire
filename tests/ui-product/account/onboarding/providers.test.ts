import { expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { endpoints, OnboardingSchema } from "@quire/contracts";
import { FederationConfigurations, emptyConfig } from "../../../../services/adapters/federation";
import { SafeHttpClient } from "../../../../services/adapters/shared";
import { ldapFixture } from "../../../adapters/federation/ldap-fixture";
import { providerFixture } from "../../../adapters/identity/provider-fixture";
import { fixtureIds } from "../../../fixtures/foundation";
import { connectionApplication } from "../../../ui-integrations/application";
import { configure, responseData } from "../../../ui-integrations/helpers";
import { startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";

test("existing native LDAP and OIDC signup returns enter isolated persisted onboarding", async () => {
  await using resources = new AsyncDisposableStack();
  const directory = resources.use(await ldapFixture());
  const provider = resources.use(await providerFixture());
  provider.state.now = Date.now();
  let root = "";
  try {
    const deployment = { organizationId: fixtureIds.institution, ldapAllowedUrls: [directory.url], ldapSubjectAttribute: "entryUUID" };
    const app = resources.use(await connectionApplication({
      federation: deployment, http: new SafeHttpClient({ fixtureOrigins: [provider.origin], timeoutMs: 5000 }),
      identityProfiles: [{ id: "google", label: "Onboarding OIDC fixture", issuer: provider.origin,
        protocol: "oidc", pkce: true, scopes: ["openid", "email", "profile"] }],
    }));
    root = app.dataDir;
    console.info("ONBOARDING_PROVIDERS_OWNED", { root, container: directory.name, provider: provider.origin });
    const configurations = new FederationConfigurations({ ...app.application.runtime,
      routes: app.application.runtime.routes.forLane("A") }, deployment);
    const current = await configurations.get();
    await app.application.runtime.uow.run(tx => configurations.save(tx, {
      config: { ...emptyConfig, version: current.config.version, protocol: "ldap", enabled: true, createOnLogin: true,
        breakGlassUserId: fixtureIds.operator, domains: ["example.test"],
        attributes: { email: "mail", name: "cn", groups: "description" },
        ldap: { url: directory.url, baseDn: "dc=example,dc=test", bindDn: "cn=admin,dc=example,dc=test",
          userFilter: "(uid={username})", caCertificate: directory.cert, secretPresent: true } },
      ldapSecret: "fixture-admin-password", oidcSecret: null,
    }));
    const operator = await app.login("operator@quire.local");
    await configure(app, operator, { kind: "identity-google", baseUrl: provider.origin,
      secret: JSON.stringify({ clientId: "google-client", clientSecret: "fixture-client-secret" }) });
    const browser = resources.use(await startEditorBrowser());
    const context = await browser.browser.newContext({ baseURL: app.url.origin });
    const page = await context.newPage();
    try {
      page.on("response", response => {
        if (new URL(response.url()).pathname.startsWith("/api/auth/")) console.info("ONBOARDING_PROVIDER_HTTP", {
          path: new URL(response.url()).pathname, status: response.status(),
        });
      });
      await page.goto("/sign-up?step=create", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Continue with Institutional directory", exact: true }).click();
      await page.getByLabel("Directory username", { exact: true }).fill("researcher");
      await page.getByLabel("Directory password", { exact: true }).fill("correct-directory-password");
      const [login] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === endpoints.ldapLogin.path),
        page.waitForURL(url => url.pathname === "/sign-up" && url.search === "?step=start"),
        page.getByRole("button", { name: "Sign in with directory", exact: true }).click(),
      ]);
      expect(login.status()).toBe(200);
      const ldapUser = await responseData(login, endpoints.ldapLogin.output);
      await waitForRenderedText(page, "Choices saved to your account.");
      const [saved] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === endpoints.onboardingSave.path && response.request().method() === "PATCH"),
        page.getByRole("button", { name: "Slides", exact: true }).click(),
      ]);
      expect(saved.status()).toBe(200);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "Choices saved to your account.");
      expect(await page.getByRole("button", { name: "Slides", exact: true }).getAttribute("aria-pressed")).toBe("true");
      const ldapProgress = await responseData(await context.request.get(endpoints.onboardingGet.path), OnboardingSchema);
      expect(ldapProgress.actorId).toBe(ldapUser.id);

      await context.clearCookies();
      await page.goto("/sign-up?step=create", { waitUntil: "domcontentloaded" });
      const options = await responseData(await context.request.get(endpoints.authOptions.path), endpoints.authOptions.output);
      const external = options.providers.find(candidate => candidate.id === "google");
      if (!external) throw new Error("Configured OIDC profile was not registered");
      console.info("ONBOARDING_PROVIDER_ENTRY", external);
      expect(external.capability.enabled).toBe(true);
      const [callback] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/google/callback"),
        page.waitForURL(url => url.pathname === "/sign-up" && url.search === "?step=start"),
        page.getByRole("button", { name: `Continue with ${external.label}`, exact: true }).click(),
      ]);
      expect(callback.status()).toBe(303);
      await waitForRenderedText(page, "Choices saved to your account.");
      const oidcProgress = await responseData(await context.request.get(endpoints.onboardingGet.path), OnboardingSchema);
      expect(oidcProgress.actorId).not.toBe(ldapProgress.actorId);
      expect(oidcProgress.choices.writingKind).toBe("paper");
      expect(oidcProgress.version).toBe(0);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "Choices saved to your account.");
      console.info("ONBOARDING_PROVIDERS_VERIFIED", { ldapStatus: login.status(), callbackStatus: callback.status(),
        ldapActor: ldapProgress.actorId, oidcActor: oidcProgress.actorId, isolated: true, reload: true });
    } catch (error) {
      console.info("ONBOARDING_PROVIDER_FAILURE", { url: page.url(), body: await page.locator("body").innerText() });
      throw error;
    } finally { await context.close(); }
  } finally {
    await resources.disposeAsync();
    expect(await access(root).then(() => true, () => false)).toBe(false);
    const inspect = Bun.spawn(["docker", "inspect", directory.name], { stdout: "pipe", stderr: "pipe" });
    expect(await inspect.exited).toBe(1);
    console.info("ONBOARDING_PROVIDERS_CLEANED", { root, exists: false, container: directory.name, containerInspectExit: 1 });
  }
}, 180_000);
