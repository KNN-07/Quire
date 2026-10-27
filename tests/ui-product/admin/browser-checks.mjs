import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { loadOmowright } = await import(pathToFileURL("/home/norman/.omo/binary-runtime/5.1.48/plugin/skills/browser/scripts/omowright.mjs").href);

/** Drive the CLI Bun 1.3 server from the kernel's supported browser transport. */
export function remoteFixture(url) {
  return {
    url,
    async getRequests() {
      const response = await fetch(new URL("/__fixture/requests", url));
      const records = await response.json();
      assert.ok(Array.isArray(records));
      return records.map(record => ({ ...record, headers: new Headers(record.headers) }));
    },
    async setControl(control) {
      const response = await fetch(new URL("/__fixture/control", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(control) });
      assert.equal(response.status, 200);
    },
    async close() { await fetch(new URL("/__fixture/close", url)); },
  };
}
// Explicit test-only HTTP responses. This does not verify the A/O/X/K implementations.
export async function runAdminBrowserChecks(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "admin-browser-"));
  const out = join(process.cwd(), "docs/evidence/p1-ui-admin");
  await mkdir(out, { recursive: true });
  const fixture = options.fixture ?? await (await import("./fixture-server.ts")).startFixture();
  console.log("FIXTURE: listening at", fixture.url);
  const { omowright } = options.runtime ?? await loadOmowright();
  console.log("BROWSER: runtime loaded");
  let browser;
  let page;
  const evidence = [];
  const labels = ["Users & groups", "Compile workers", "TeX Live images", "AI provider", "Templates", "Storage & backups", "Updates", "Support", "Audit log"];
  try {
    browser = await omowright.connectPipe({
      browserPath: "/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
      browserArgs: ["--headless", "--no-sandbox", `--user-data-dir=${root}`],
      storageRoot: root,
    });
    console.log("BROWSER: owned pipe connected");
    page = await browser.newTab("about:blank");
    const sid = await page.resolveSessionId();
    const capture = async name => {
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        dpr: devicePixelRatio,
        touch: navigator.maxTouchPoints,
        coarsePointer: matchMedia("(pointer:coarse)").matches,
        overflow: document.documentElement.scrollWidth > innerWidth,
        title: document.title,
        scrollOwners: [...document.querySelectorAll("*")].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight).map(el => el.className),
      }));
      assert.equal(metrics.width, name.includes("iphone-14") ? 390 : 1440, `${name} viewport must match its evidence label`);
      if (name.includes("iphone-14")) {
        assert.equal(metrics.dpr, 3, "phone capture uses native DPR 3");
        assert.ok(metrics.touch > 0 && metrics.coarsePointer, "phone capture has actual touch emulation");
      }
      assert.equal(metrics.overflow, false, `${name} must not overflow`);
      await writeFile(join(out, `${name}.png`), await page.screenshot({ fullPage: false }));
      await page.evaluate(() => {
        const main = document.getElementById("admin-content");
        if (main) main.scrollTop = main.scrollHeight;
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      await writeFile(join(out, `${name}-end.png`), await page.screenshot({ fullPage: false }));
      await page.evaluate(() => { document.getElementById("admin-content")?.scrollTo({ top: 0 }); window.scrollTo({ top: 0 }); });
      evidence.push({ name, ...metrics });
    };
    // Given: each viewport/theme and real React mounted against the explicit fixture API.
    for (const device of ["desktop-1440", "iphone-14"]) {
      await omowright.emulate(page, device);
      for (const theme of ["light", "dark"]) {
        await page.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] }, sid);
        await page.goto(fixture.url);
        await omowright.repinViewport(page, { width: device === "iphone-14" ? 390 : 1440, height: device === "iphone-14" ? 844 : 900 });
        const mobile = device === "iphone-14";
        await page.cdp.send("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1440, height: mobile ? 844 : 900, deviceScaleFactor: mobile ? 3 : 1, mobile }, sid);
        await page.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 1 }, sid);
        await page.cdp.send("Emulation.setScrollbarsHidden", { hidden: mobile }, sid);
        await page.locator("main h1").waitFor({ state: "visible" });
        assert.equal(await page.locator("main h1").innerText(), "Server overview");
        await capture(`overview-${device}-${theme}`);
        for (const label of labels) {
          // When: choose each dedicated operations workflow.
          const section = { "Users & groups": "users", "Compile workers": "workers", "TeX Live images": "tex", "AI provider": "ai", Templates: "templates", "Storage & backups": "storage", Updates: "updates", Support: "support", "Audit log": "audit" }[label];
          if (mobile) await page.locator('select[aria-label="Administration section"]').selectOption(section);
          else await page.locator(`nav a[href="/admin/${section}"]`).click();
          await page.locator("main h1").waitFor({ state: "visible" });
          assert.equal(await page.locator("main h1").innerText(), label);
          // Then: concurrency and target identifiers are chosen from fetched resources.
          assert.equal(await page.locator('input[name*="expectedVersion"],input[name="etag"],input[name="body.poolId"]').count(), 0);
          await capture(`${label.replaceAll(/[^a-zA-Z]+/g, "-").toLowerCase()}-${device}-${theme}`);
        }
        if (mobile) await page.locator('select[aria-label="Administration section"]').selectOption("identity");
        else await page.locator('nav a[href="/admin/identity"]').click();
        await page.locator('select[name="protocol"]').waitFor({ state: "visible" });
        assert.equal(await page.locator(".admin-resource").count(), 0, "identity must not retain prior resource panels");
        for (const protocol of ["saml", "oidc", "ldap"]) {
          await page.locator('select[name="protocol"]').selectOption(protocol);
          const expected = { saml: "Entity ID", oidc: "Issuer", ldap: "Directory TLS URL" }[protocol];
          assert.ok((await page.locator("main").innerText()).includes(expected));
          await capture(`identity-${protocol}-${device}-${theme}`);
        }
        if (mobile) await page.locator('select[aria-label="Administration section"]').selectOption("architecture");
        else await page.locator('nav a[href="/admin/architecture"]').click();
        assert.equal(await page.locator("main h1").innerText(), "Server architecture");
        assert.equal(await page.locator(".admin-resource").count(), 0, "architecture must not retain prior resource panels");
        assert.ok((await page.locator("main").innerText()).includes("SQLite WAL"));
        await capture(`architecture-${device}-${theme}`);
      }
    }
    await omowright.emulate(page, "desktop-1440");
    await omowright.repinViewport(page, { width: 1440, height: 900 });
    await page.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
    await page.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }, sid);
    // Given: an authorized operator, no workers and no previous create request.
    await page.locator('nav a[href="/admin/workers"]').click();
    await page.locator('button').filter({ hasText: /^Add worker$/ }).click();
    await page.locator('#add-workers input[type="number"]').fill("2");
    const beforeCreate = (await fixture.getRequests()).filter(item => item.method === "POST" && item.path === "/api/admin/workers").length;
    // When: review and cancel a consequential operation.
    await page.locator("dialog[open]").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
    // Then: no HTTP mutation was sent.
    assert.equal((await fixture.getRequests()).filter(item => item.method === "POST" && item.path === "/api/admin/workers").length, beforeCreate);
    // Given: the same valid worker draft.
    // When: explicitly confirm.
    await page.locator('button').filter({ hasText: /^Add worker$/ }).click();
    await page.locator('#add-workers input[type="number"]').fill("2");
    await page.locator("dialog[open] .q-modal__footer button").last().click();
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
    // Then: the exact parsed request, CSRF and idempotency headers reach the HTTP fixture.
    const workerRequest = (await fixture.getRequests()).find(item => item.method === "POST" && item.path === "/api/admin/workers");
    assert.deepEqual(workerRequest?.body, { poolId: "00000000-0000-4000-8000-000000000010", count: 2 });
    assert.equal(workerRequest.headers.get("x-csrf-token"), "fixture-csrf");
    assert.ok(workerRequest.headers.get("idempotency-key"));
    assert.ok((await page.locator("main").innerText()).includes("queued"));
    await capture("worker-confirmed");
    // Given: a fetched identity version 7.
    await page.locator('nav a[href="/admin/identity"]').click();
    await page.locator('select[name="protocol"]').waitFor({ state: "visible" });
    const certificate = "-----BEGIN CERTIFICATE-----\nfixture-only-line-one\nfixture-only-line-two\n-----END CERTIFICATE-----";
    await page.locator('input[name="entityId"]').fill("https://identity.example.test/entity");
    await page.locator('input[name="ssoUrl"]').fill("https://identity.example.test/sso");
    await page.locator('textarea[name="certificates"]').fill(certificate);
    await page.locator('main>.admin-content>form button[type="submit"]').click();
    await page.locator("dialog[open] .q-modal__footer button").last().click();
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
    const samlSave = (await fixture.getRequests()).find(item => item.method === "PUT" && item.path === "/api/admin/identity");
    assert.deepEqual(samlSave.body.saml.certificates, [certificate], "multiline PEM stays one certificate");
    assert.equal(samlSave.headers.get("if-match"), '"v7"');
    await page.locator('select[name="protocol"]').selectOption("oidc");
    await page.locator('input[name="issuer"]').fill("https://identity.example.test");
    await page.locator('input[name="clientId"]').fill("fixture-client");
    await page.locator('input[name="scopes"]').fill("openid email");
    // When: save after confirmation.
    await page.locator('main>.admin-content>form button[type="submit"]').click();
    await page.locator("dialog[open] .q-modal__footer button").last().click();
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
    // Then: returned versions, not guessed revisions, protect both saves.
    assert.equal((await fixture.getRequests()).filter(item => item.method === "PUT" && item.path === "/api/admin/identity").at(-1)?.headers.get("if-match"), '"v8"');
    await page.locator('main>.admin-content>form button[type="submit"]').click();
    await page.locator("dialog[open] .q-modal__footer button").last().click();
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
    assert.equal((await fixture.getRequests()).filter(item => item.method === "PUT" && item.path === "/api/admin/identity").at(-1)?.headers.get("if-match"), '"v9"');
    // Given: configured draft, handshake endpoint returns queued.
    // When: test the connection.
    await page.locator("main>.admin-content>form .admin-row button").first().click();
    await page.locator('section[aria-label="Identity test operation"]').waitFor({ state: "visible" });
    // Then: the UI does not turn a queued operation into verified authentication.
    assert.ok((await page.locator('section[aria-label="Identity test operation"]').innerText()).includes("queued"));
    await capture("identity-saved-test-queued");
    // Given: the worker service is unavailable.
    await fixture.setControl({ workersError: true });
    // When: open its panel.
    await page.locator('nav a[href="/admin/workers"]').click();
    await page.locator('[role="alert"]').waitFor({ state: "visible" });
    // Then: preserve the server error rather than rendering zero workers as health.
    assert.ok((await page.locator('[role="alert"]').innerText()).includes("UNAVAILABLE"));
    await capture("workers-unavailable");
    // Given: operator authority is denied.
    await fixture.setControl({ denied: true });
    // When: reload the actual page.
    await page.goto(fixture.url);
    await page.locator("main h1").waitFor({ state: "visible" });
    assert.equal(await page.locator("main h1").innerText(), "Operator access denied");
    // Then: no mutating forms exist.
    assert.equal(await page.locator("form").count(), 0);
    await capture("operator-denied");
    await fixture.setControl({ denied: false, overviewUnavailable: true });
    await page.goto(fixture.url);
    await page.locator("main h1").waitFor({ state: "visible" });
    assert.equal(await page.locator("main h1").innerText(), "Administration unavailable");
    assert.equal(await page.locator("form").count(), 0);
    await capture("overview-unimplemented");
    await writeFile(join(out, "browser-results.json"), JSON.stringify({ result: "PASS", evidence, assertions: ["all nine panels at 1440/390, light/dark", "all three identity protocols", "architecture local topology", "cancel sends no mutation", "worker headers and payload", "multiline PEM preserved", "identity ETags 7, 8, 9", "handshake remains queued", "503 preserved", "403 hides controls", "501 hides controls"], backend: "Explicit HTTP fixture only; real backend pending integration." }, null, 2));
    console.log(`PASS: admin browser checks; ${evidence.length} captures.`);
  } catch (error) {
    if (page) {
      await writeFile(join(out, "browser-failure.png"), await page.screenshot({ fullPage: false }));
      const state = await page.evaluate(() => ({ text: document.body.innerText, html: document.body.innerHTML }));
      console.error(JSON.stringify(state));
      await writeFile(join(out, "browser-failure.json"), JSON.stringify({ error: error instanceof Error ? error.message : String(error), state }, null, 2));
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
    console.log("CLEANUP: browser, API and owned profile closed/removed.");
  }
}
if (import.meta.main) await runAdminBrowserChecks();
