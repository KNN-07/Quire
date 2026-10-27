import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createApplication } from "../../../apps/server/src/composition";
import { loadConfig } from "@quire/runtime";
import { register, migrations } from "../../../services/accounts/identity";
import { seed } from "../../../scripts/seed";
import { readLocalMail } from "../../../services/accounts/identity/mail";
import { fixtureIds, defaultPolicy } from "../../../tests/fixtures/foundation";
import { chromium, devices } from "@playwright/test";
import { checkAuthentication, checkProfile, checkPreferences, checkReset, checkRegistration, checkUnbilled, checkVersionConflict, checkPreferenceTabs, measure } from "../../../tests/ui-product/account/browser-checks.mjs";
import { checkCredentialBoundary } from "../../../tests/ui-product/account/credential-checks.mjs";
import { checkExportAndLogout, checkResetSuccess } from "../../../tests/ui-product/account/session-checks.mjs";
import { checkAuthOptions, checkSavedNotifications, checkNativeSessionAndIdentities, checkIdentityAccountCounter } from "../../../tests/ui-product/account/read-contract-checks.mjs";
import { checkInvoicesAndPortal } from "../../../tests/ui-product/account/payment-checks.mjs";
import { checkProfileMedia } from "../../../tests/ui-product/account/profile-media-checks.mjs";

const temporary = await mkdtemp("/tmp/quire-account-");
process.env.TMPDIR = temporary;
process.env.XDG_CACHE_HOME = join(temporary, "cache");
const evidence = import.meta.dir;
const root = resolve(evidence, "../../..");
const results = { cases: [], requests: [], cleanup: {}, boundary: "Actual local identity service/SQLite/cookies/CSRF for auth options, linked-identity reads, session revocation, authentication, profile and preferences. Unsupported services retain real 501 responses in base captures. Explicit HTTP-only federation availability, saved notification settings, billing invoices/portal and Git-credential fixtures run separately; they are not external-service completion evidence." };
let server, application, browser;
try {
  const build = await Bun.build({ entrypoints: [join(evidence, "preview.tsx")], outdir: join(temporary, "build"), target: "browser", minify: true });
  assert.equal(build.success, true, JSON.stringify(build.logs));
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/api/")) {
        const response = await application.fetch(request);
        results.requests.push({ method: request.method, path, status: response.status });
        return response;
      }
      if (path.startsWith("/preview.") || path.endsWith(".woff2")) return new Response(Bun.file(join(temporary, "build", path.slice(1))));
      return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quire account verification</title><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>', { headers: { "content-type": "text/html" } });
    },
  });
  application = await createApplication({ config: loadConfig({ QUIRE_DATA_DIR: join(temporary, "data"), QUIRE_PUBLIC_URL: server.url.origin }), modules: [{ id: "010-a-identity", lane: "A", order: 10, register, migrations }] });
  const password = "account-browser-test-1234";
  await seed(application.runtime, password);
  application.runtime.db.query("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,?,?,?)").run(fixtureIds.outsider, fixtureIds.kien, "test-oidc", "saved-author-subject", application.runtime.clock.now());
  browser = await chromium.launch({
    executablePath: "/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
    headless: true,
    args: ["--no-sandbox"],
  });
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext(width === 390 ? { ...devices["iPhone 14"], colorScheme: theme } : { viewport: { width, height: 900 }, colorScheme: theme });
    const page = await context.newPage();
    await checkAuthentication(page, server.url.origin, password);
    const other = await browser.newContext();
    let otherSession;
    try {
      const otherPage = await other.newPage();
      await otherPage.goto(server.url.origin + "/sign-in", { waitUntil: "commit" });
      await otherPage.getByRole("textbox", { name: "Email", exact: true }).fill("kien@quire.local");
      await otherPage.getByLabel("Password", { exact: true }).fill(password);
      await otherPage.getByRole("button", { name: "Sign in", exact: true }).click();
      await otherPage.getByRole("heading", { name: "Project navigation reached" }).waitFor({ state: "visible", timeout: 10000 });
      const sessions = await (await other.request.get(server.url.origin + "/api/me/sessions")).json();
      otherSession = sessions.data.items.find(session => session.current);
      assert.ok(otherSession);
      application.runtime.db.query("UPDATE sessions SET version=9 WHERE id=?").run(otherSession.id);
    } finally { await other.close(); }
    await checkNativeSessionAndIdentities(page, server.url.origin, otherSession.id);
    await checkProfile(page, server.url.origin, `Account Test ${width} ${theme}`);
    const extraEmail = `extra-${width}-${theme}@quire.local`;
    application.runtime.db.query("INSERT INTO verified_emails(id,user_id,email,verified_at) VALUES(?,?,?,?)").run(crypto.randomUUID(), fixtureIds.kien, extraEmail, application.runtime.clock.now());
    await checkProfileMedia(page, server.url.origin, extraEmail);
    await checkPreferences(page, server.url.origin, 17 + (width === 390 ? 2 : 0) + (theme === "dark" ? 1 : 0));
    await checkVersionConflict(page, server.url.origin, () => { application.runtime.db.query("UPDATE users SET version=version+1 WHERE id=?").run(fixtureIds.kien); });
    await checkPreferenceTabs(page, server.url.origin);
    await checkReset(page, server.url.origin);
    await checkRegistration(page, server.url.origin, `new-${width}-${theme}@quire.local`, email => {
      const mail = readLocalMail(join(temporary, "data")).find(item => item.recipient === email);
      assert.ok(mail);
      return new URL(mail.body.split("\n")[0]);
    });
    const captures = [];
    for (const path of ["/sign-in", "/sign-up", "/sign-up?step=verify", "/sign-up?step=start", "/reset-password", "/reset-password?token=invalid", "/settings/profile", "/settings/security", "/settings/editor", "/settings/ai", "/settings/git", "/settings/notifications", "/settings/billing"]) {
      await page.goto(server.url.origin + path, { waitUntil: "commit" });
      await page.getByRole("heading").first().waitFor({ state: "visible", timeout: 10000 });
      if (path.startsWith("/settings/")) await page.getByRole("heading", { level: 2 }).first().waitFor({ state: "visible", timeout: 10000 });
      await page.getByRole("status").first().waitFor({ state: "hidden", timeout: 10000 });
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await page.evaluate(() => document.fonts.ready);
      const measurements = await measure(page);
      assert.equal(measurements.horizontalOverflow, false, path);
      if (width === 390) assert.ok(measurements.controls.every(control => control.height >= 44), path + ": touch target height");
      if (measurements.avatar) assert.deepEqual(measurements.avatar, { width: 72, height: 72 });
      if (measurements.resetFillsViewport !== null) assert.equal(measurements.resetFillsViewport, true);
      const file = `${path.slice(1).replaceAll(/[/?=]/g, "-")}-${width}-${theme}.png`;
      const image = await page.screenshot({ fullPage: true, type: "png" });
      assert.equal(image.subarray(1, 4).toString(), "PNG");
      await Bun.write(join(evidence, file), image);
      await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
      await Bun.write(join(evidence, file.replace(".png", "-end.png")), await page.screenshot({ fullPage: false, type: "png" }));
      captures.push({ path, file, ...measurements });
    }
    await checkAuthOptions(page, server.url.origin);
    await checkIdentityAccountCounter(page, server.url.origin, fixtureIds);
    const notificationImage = await checkSavedNotifications(page, server.url.origin, fixtureIds);
    await Bun.write(join(evidence, `notification-saved-boundary-${width}-${theme}.png`), notificationImage);
    const billingFixture = {
      requestId: fixtureIds.kien,
      organization: { id: fixtureIds.team, slug: "robotics-lab", name: "Robotics Lab", kind: "team", domains: [], policy: defaultPolicy, version: 0 },
      billing: { id: fixtureIds.team, organizationId: fixtureIds.team, userId: null, provider: "manual", planId: null, period: "year", seats: 0, status: "unbilled", renewsAt: null, invoiceEmail: "billing@quire.local", taxId: "", address: "", version: 23 },
    };
    await checkUnbilled(page, server.url.origin, billingFixture);
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await Bun.write(join(evidence, `billing-unbilled-boundary-${width}-${theme}.png`), await page.screenshot({ fullPage: true, type: "png" }));
    const paymentImage = await checkInvoicesAndPortal(page, server.url.origin, billingFixture);
    await Bun.write(join(evidence, `billing-invoices-portal-boundary-${width}-${theme}.png`), paymentImage);
    await checkCredentialBoundary(page, server.url.origin, fixtureIds);
    await checkExportAndLogout(page, server.url.origin);
    await checkResetSuccess(page, server.url.origin, {
      email: `new-${width}-${theme}@quire.local`,
      read() {
        const mail = readLocalMail(join(temporary, "data")).find(item => item.recipient === this.email && item.body.startsWith(server.url.origin + "/reset-password"));
        assert.ok(mail); return new URL(mail.body.split("\n")[0]);
      },
    });
    results.cases.push({ width, theme, checks: { realAuthOptionsAndLinkedIdentityReads: true, accountMeCounterForIdentityMutations: true, realVersionedSessionRevocation: true, realAvatarReadUploadRemoveAndEmailRemove: true, realLoginFailureAndSuccess: true, persistedProfile: true, persistedPreferences: true, versionConflictPreservesEdits: true, persistedAiAndGitPreferences: true, resetMismatchAndInvalidToken: true, realRegistrationAndEmailVerification: true, realResetSuccessAndRelogin: true, realExportDownloadAndLogout: true, providerAvailabilityBoundaryOnly: true, savedNotificationsBoundaryOnly: true, invoicesAndHostedPortalBoundaryOnly: true, unbilledHttpBoundaryOnly: true, gitCredentialHttpBoundaryOnly: true }, captures });
    await context.close();
    console.log(`PASS ACCOUNT ${width} ${theme}`);
  }
  results.root = root;
} catch (error) {
  results.failure = (error instanceof Error ? error.stack ?? error.message : String(error)).replaceAll(/quire_session=[A-Za-z0-9_-]+/g, "quire_session=[REDACTED]");
  throw error;
} finally {
  if (browser) { await browser.close(); results.cleanup.browserClosed = true; }
  if (server) { server.stop(true); results.cleanup.serverStopped = true; }
  if (application) { application.close(); results.cleanup.databaseClosed = true; }
  await rm(temporary, { recursive: true, force: true });
  results.cleanup.temporaryRoot = temporary; results.cleanup.removed = true;
  if (results.failure) await Bun.write(join(evidence, `failure-${Date.now()}.json`), JSON.stringify(results, null, 2) + "\n");
  await Bun.write(join(evidence, "results.json"), JSON.stringify(results, null, 2) + "\n");
}
console.log("ACCOUNT_UI_VERIFIED");
