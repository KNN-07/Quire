import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { connectionApplication } from "../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../ui-editor/shared/browser";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { certificate, authnRequestId, signedResponse } from "./signed-idp";
import { FederationConfigurations, emptyConfig } from "../../../services/adapters/federation";
import { SafeHttpClient } from "../../../services/adapters/shared";

test("composed organization SAML reminder, unlink-one/all and managed identifier relink in Chromium", async () => {
  const evidence = `docs/evidence/p73-saml-administration/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  await using signer = await certificate();
  let origin = "";
  let subject = "mai-browser-original";
  const idp = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    const response = signedResponse({ ...signer, subject, requestId: authnRequestId(url.href),
      issuer: "https://idp.example.test", audience: `${origin}/api/admin/identity/metadata.xml`,
      destination: `${origin}/api/auth/saml/acs` });
    return new Response(`<form method="post" action="${origin}/api/auth/saml/acs">
      <input name="RelayState" value="${url.searchParams.get("RelayState")}">
      <input name="SAMLResponse" value="${response}"></form><script>document.forms[0].submit()</script>`,
    { headers: { "content-type": "text/html" } });
  } });
  let root = "";
  try {
    await using app = await connectionApplication({ federation: { organizationId: ids.institution },
      http: new SafeHttpClient({ fixtureOrigins: [idp.url.origin] }) });
    origin = app.url.origin;
    root = app.dataDir;
    console.info("P73_BROWSER_OWNED", { root, origin, idp: idp.url.origin, evidence });
    const runtime = app.application.runtime;
    await runtime.db.run(`INSERT INTO members(id,organization_id,user_id,role,licensed,created_at)
      VALUES(?,?,?,'member',0,?)`, [crypto.randomUUID(), ids.institution, ids.mai, runtime.clock.now()]);
    const context = { ...runtime, routes: runtime.routes.forLane("A") };
    const configurations = new FederationConfigurations(context, { organizationId: ids.institution });
    await runtime.uow.run(tx => configurations.save(tx, { config: { ...emptyConfig,
      protocol: "saml", enabled: true, domains: ["example.test"], breakGlassUserId: ids.operator,
      saml: { entityId: "https://idp.example.test", ssoUrl: idp.url.href, metadataXml: "", certificates: [signer.cert] } },
      oidcSecret: null, ldapSecret: null }));
    await using browser = await startEditorBrowser();
    await using admin = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    const page = await admin.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => { void dialog.accept(); });
    await page.goto("/settings/organizations");
    await page.getByRole("button", { name: /Quire Institute/ }).click();
    const panel = page.getByRole("region", { name: "Organization SAML links" });
    const member = panel.getByLabel("SAML member mai@quire.local", { exact: true });
    await member.getByText("Not linked", { exact: true }).waitFor();
    const reminder = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/saml-links"));
    await member.getByRole("button", { name: "Remind member", exact: true }).click();
    const reminded = await reminder;
    expect(reminded.status()).toBe(200);
    expect(await reminded.json()).toMatchObject({ data: { queued: 1, signedOut: false } });
    await waitForRenderedText(page, "Reminder queued in the local outbox.");
    expect(await runtime.db.get("SELECT status FROM mail_outbox WHERE subject='Link your institutional SAML identity'")).toEqual({ status: "local" });
    async function link(changedSubject: string) {
      subject = changedSubject;
      await using account = await authenticatedContext(browser, app, { email: "mai@quire.local" });
      const accountPage = await account.context.newPage();
      await accountPage.goto("/settings/identities");
      const callback = accountPage.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/saml/acs");
      await accountPage.getByRole("button", { name: "Link Institutional SAML", exact: true }).click();
      expect((await callback).status()).toBe(303);
      await accountPage.getByRole("button", { name: "Unlink https://idp.example.test", exact: true }).waitFor();
      return account.session.user.id;
    }
    await link(subject);
    await panel.getByRole("button", { name: "Refresh SAML links" }).click();
    await member.getByText("Linked", { exact: true }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await panel.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/linked-${width}.png`, fullPage: true });
    }
    const unlink = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/saml-links"));
    await member.getByRole("button", { name: "Unlink member", exact: true }).click();
    expect((await unlink).status()).toBe(200);
    await member.getByText("Not linked", { exact: true }).waitFor();
    await link("mai-browser-new");
    await runtime.db.run("UPDATE users SET managed_by=? WHERE id=?", [ids.institution, ids.mai]);
    await runtime.db.run(`INSERT INTO managed_acceptances(id,organization_id,user_id,state,created_at)
      VALUES(?,?,?,'accepted',?)`, [crypto.randomUUID(), ids.institution, ids.mai, runtime.clock.now()]);
    await panel.getByRole("button", { name: "Refresh SAML links" }).click();
    await member.getByText("Linked", { exact: true }).waitFor();
    const bulk = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/saml-links"));
    await panel.getByRole("button", { name: "Unlink all SAML users", exact: true }).click();
    expect((await bulk).status()).toBe(200);
    await member.getByText("Not linked", { exact: true }).waitFor();
    await link("mai-browser-managed-reset");
    expect(await runtime.db.get("SELECT managed_by FROM users WHERE id=?", [ids.mai])).toEqual({ managed_by: ids.institution });
    expect(await runtime.db.get("SELECT user_id FROM federation_saml_relinks WHERE user_id=?", [ids.mai])).toBeNull();
    expect(await runtime.db.get("SELECT id FROM projects WHERE id=?", [ids.project])).not.toBeNull();
    expect(errors).toEqual([]);
    console.info("P73_BROWSER_VERIFIED", { evidence, errors });
  } finally { await idp.stop(true); }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("P73_BROWSER_CLEANED", { root, evidence });
}, 180_000);
