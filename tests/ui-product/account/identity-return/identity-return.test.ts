import { expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { endpoints, parseResourceVersionTag, resultSchema } from "@quire/contracts";
import { SafeHttpClient } from "../../../../services/adapters/shared";
import { providerFixture } from "../../../adapters/identity/provider-fixture";
import { connectionApplication } from "../../../ui-integrations/application";
import { configure, contextFor, responseData } from "../../../ui-integrations/helpers";
import { startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import type { Page } from "@playwright/test";

const evidence = resolve(import.meta.dir, "../../../../docs/evidence/p6-identity-ui");

async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
}

test("follows authoritative OIDC redirect, returns persisted identity, denies replay and signs out after unlink", async () => {
  await using provider = await providerFixture();
  provider.state.now = Date.now();
  const app = await connectionApplication({
    http: new SafeHttpClient({ fixtureOrigins: [provider.origin], timeoutMs: 5000 }),
    identityProfiles: [
      { id: "google", label: "Google fixture", issuer: provider.origin, protocol: "oidc",
        pkce: true, scopes: ["openid", "email", "profile"] },
      { id: "orcid", label: "ORCID fixture", issuer: provider.origin, protocol: "oidc",
        pkce: false, scopes: ["openid"] },
    ],
  });
  const root = app.dataDir;
  const origin = app.url.origin;
  try {
    await using ownedBrowser = await startEditorBrowser();
    const operator = await app.login("operator@quire.local");
    await configure(app, operator, { kind: "identity-google", baseUrl: provider.origin,
      secret: JSON.stringify({ clientId: "google-client", clientSecret: "fixture-client-secret" }) });
    const actor = await app.login();
    const context = await contextFor(ownedBrowser.browser, { app, session: actor });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      await page.goto("/settings/security", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "Link Google fixture");
      expect(await page.getByRole("button", { name: "Link ORCID fixture", exact: true }).isDisabled()).toBe(true);
      await capture(page, "unlinked-desktop");
      await page.setViewportSize({ width: 390, height: 844 });
      await capture(page, "unlinked-mobile");
      await page.setViewportSize({ width: 1440, height: 900 });

      // Subscribe to actual HTTP and navigation before the Link action.
      const linkResponse = page.waitForResponse(r => new URL(r.url()).pathname === "/api/me/identities/google/link", { timeout: 30000 });
      const authorization = page.waitForRequest(r => r.url().startsWith(provider.origin + "/authorize?"), { timeout: 30000 });
      const callback = page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/google/callback", { timeout: 30000 });
      const returned = page.waitForEvent("framenavigated", {
        predicate: frame => frame === page.mainFrame() && frame.url() === origin + "/settings/identities",
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Link Google fixture", exact: true }).click();
      const linked = await linkResponse;
      const binding = (await linked.headerValue("set-cookie"))?.match(/quire_identity_google=([^;]+)/)?.[1];
      if (!binding) throw new Error("Initiating browser cookie missing");
      const authorized = await authorization;
      expect(await linked.headerValue("location")).toBe(authorized.url());
      const redirect = new URL(authorized.url());
      expect(redirect.searchParams.get("redirect_uri")).toBe(origin + "/api/auth/google/callback");
      expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
      expect(redirect.searchParams.get("state")).toBeTruthy();
      expect(redirect.searchParams.get("nonce")).toBeTruthy();
      const completed = await callback;
      expect(completed.status()).toBe(303);
      expect(await completed.headerValue("location")).toBe("/settings/identities");
      await returned;
      await page.waitForLoadState("domcontentloaded");
      await waitForRenderedText(page, "subject-one");
      expect(await page.getByRole("link", { name: "Sign-in & SSO", exact: true }).getAttribute("aria-current")).toBe("page");
      const identities = await responseData(await context.request.get("/api/me/identities?limit=200"), endpoints.identitiesList.output);
      expect(identities.items).toHaveLength(1);
      const identity = identities.items[0];
      if (!identity) throw new Error("Persisted identity missing");
      expect(identity.issuer).toBe(provider.origin);
      expect(identity.subject).toBe("subject-one");
      expect(provider.observations).toEqual(["token"]);
      expect((await fetch(origin + "/api/me", { headers: actor.headers })).status).toBe(401);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await capture(page, `linked-${width}`);
      }

      // A foreign browser and then the original browser cannot replay the callback.
      const foreign = await ownedBrowser.browser.newContext();
      try {
        const denied = await foreign.request.get(completed.url(), {
          maxRedirects: 0, headers: { cookie: "quire_identity_google=wrong-browser" },
        });
        expect(denied.status()).toBe(400);
        console.info("IDENTITY_FOREIGN_CALLBACK", await denied.json());
      } finally { await foreign.close(); }
      const replay = await context.request.get(completed.url(), {
        maxRedirects: 0, headers: { cookie: `quire_identity_google=${binding}` },
      });
      expect(replay.status()).toBe(400);
      console.info("IDENTITY_REPLAY_DENIED", await replay.json());
      expect(provider.observations).toEqual(["token"]);
      console.info("IDENTITY_REDIRECT_CALLBACK", {
        authorizationOrigin: redirect.origin, callbackPath: new URL(completed.url()).pathname,
        callbackStatus: completed.status(), returnPath: "/settings/identities",
        identity, replayStatus: replay.status(),
      });

      // A real competing account mutation preserves the version error in this UI.
      const currentResponse = await context.request.get("/api/me");
      const current = resultSchema(endpoints.me.output).parse(await currentResponse.json());
      if (!("data" in current)) throw new Error("Session unavailable after callback");
      const changed = await context.request.patch("/api/me", {
        headers: { origin, "x-csrf-token": current.data.csrfToken },
        data: { expectedVersion: parseResourceVersionTag(currentResponse.headers()["etag"] ?? null), name: "Identity Browser Author" },
      });
      expect(changed.status(), await changed.text()).toBe(200);
      const stale = page.waitForResponse(r => r.request().method() === "DELETE" && new URL(r.url()).pathname === `/api/me/identities/${identity.id}`, { timeout: 30000 });
      await page.getByRole("button", { name: `Unlink ${provider.origin}`, exact: true }).click();
      const conflict = await stale;
      expect(conflict.status()).toBe(409);
      const rejected = resultSchema(endpoints.identityUnlink.output).parse(await conflict.json());
      expect("error" in rejected ? rejected.error.code : null).toBe("VERSION_CONFLICT");
      await waitForRenderedText(page, "Account changed");
      expect((await context.request.get("/api/me")).status()).toBe(200);
      await capture(page, "stale-unlink-mobile");
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "subject-one");
      const other = await app.login();
      expect((await fetch(origin + "/api/me", { headers: other.headers })).status).toBe(200);

      // Successful unlink revokes sessions: no authenticated list refresh follows it.
      const unlink = page.waitForResponse(r => r.request().method() === "DELETE" && new URL(r.url()).pathname === `/api/me/identities/${identity.id}`, { timeout: 30000 });
      const signedOut = page.waitForEvent("framenavigated", {
        predicate: frame => frame === page.mainFrame() && frame.url() === origin + "/sign-in", timeout: 30000,
      });
      const requests: string[] = [];
      page.on("request", request => requests.push(new URL(request.url()).pathname));
      await page.getByRole("button", { name: `Unlink ${provider.origin}`, exact: true }).click();
      expect((await unlink).status()).toBe(200);
      await signedOut;
      await page.waitForLoadState("domcontentloaded");
      await waitForRenderedText(page, "Sign in");
      expect(requests.filter(path => path === "/api/me/identities")).toEqual([]);
      expect((await context.request.get("/api/me")).status()).toBe(401);
      expect((await fetch(origin + "/api/me", { headers: other.headers })).status).toBe(401);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await capture(page, `signed-out-${width}`);
      }
      const fresh = await app.login();
      const remaining = await fetch(origin + "/api/me/identities?limit=200", { headers: fresh.headers });
      expect((await responseData(remaining, endpoints.identitiesList.output)).items).toEqual([]);
      expect(pageErrors).toEqual([]);
      console.info("IDENTITY_UNLINK_VERIFIED", { requests, persistedIdentities: 0, pageErrors });
    } finally { await context.close(); }
  } finally {
    await app[Symbol.asyncDispose]();
    expect(await access(root).then(() => true, () => false)).toBe(false);
    console.info("IDENTITY_CLEANED", { root, origin, provider: provider.origin });
  }
}, 180000);
