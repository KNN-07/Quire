import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Real React/client checks against the explicit HTTP fixture, not service acceptance. */
export async function runUsersBrowserChecks({ fixture, runtime }) {
  const profile = await mkdtemp(join(tmpdir(), "quire-users-browser-"));
  const evidence = join(process.cwd(), "docs/evidence/lead-admin");
  await mkdir(evidence, { recursive: true });
  const { omowright } = runtime;
  let browser;
  try {
    browser = await omowright.connectPipe({
      browserPath: "/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
      browserArgs: ["--headless", "--no-sandbox", `--user-data-dir=${profile}`],
      storageRoot: profile,
    });
    const page = await browser.newTab("about:blank");
    const measurements = [];
    for (const device of ["desktop-1440", "iphone-14"]) {
      for (const theme of ["light", "dark"]) {
        await omowright.emulate(page, device);
        await page.goto(fixture.url, { waitUntil: "load" });
        await omowright.repinViewport(page, { width: device === "iphone-14" ? 390 : 1440, height: device === "iphone-14" ? 844 : 900 });
        const sessionId = await page.resolveSessionId();
        const mobile = device === "iphone-14";
        await page.cdp.send("Emulation.setDeviceMetricsOverride", {
          width: mobile ? 390 : 1440, height: mobile ? 844 : 900,
          deviceScaleFactor: mobile ? 3 : 1, mobile,
        }, sessionId);
        await page.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 1 }, sessionId);
        await page.cdp.send("Emulation.setScrollbarsHidden", { hidden: mobile }, sessionId);
        await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        if (device === "iphone-14") {
          await page.locator('select[aria-label="Administration section"]').waitFor({ state: "visible" });
          await page.locator('select[aria-label="Administration section"]').selectOption("users");
        } else {
          await page.locator('a[href="/admin/users"]').waitFor({ state: "visible" });
          await page.locator('a[href="/admin/users"]').click();
        }
        await page.locator(".admin-user-table").waitFor({ state: "visible" });
        await page.evaluate(async () => { await document.fonts.ready; });
        const metrics = await page.evaluate(() => ({
          width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          manualVersions: document.querySelectorAll('input[name*="expectedVersion"],input[name="etag"]').length,
          rows: document.querySelectorAll(".admin-user-table tbody tr").length,
        }));
        assert.equal(metrics.width, device === "iphone-14" ? 390 : 1440);
        assert.equal(metrics.scrollWidth, metrics.width);
        assert.equal(metrics.manualVersions, 0);
        assert.equal(metrics.rows, 4);
        await writeFile(join(evidence, `users-${device}-${theme}.png`), await page.screenshot({ fullPage: true }));
        measurements.push({ device, theme, ...metrics });
      }
    }
    // Given: a rendered user whose persisted version is 7, not a synthetic zero.
    await omowright.emulate(page, "desktop-1440");
    await page.locator(".admin-user-table tbody tr:first-child button").click();
    await page.locator("#manage-user").waitFor({ state: "visible" });
    assert.equal(await page.locator('input[name*="expectedVersion"]').count(), 0);
    // When: edit only the human-facing name and save.
    await page.locator('#manage-user input:not([type="checkbox"])').first().fill("Kien browser check");
    await page.locator('button[form="manage-user"]').click();
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
    // Then: the fetched concurrency guard, actual target and CSRF reach HTTP.
    const requests = await fixture.getRequests();
    const patch = requests.find(request => request.method === "PATCH" && request.path === "/api/admin/users/00000000-0000-4000-8000-000000000001");
    assert.deepEqual(patch?.body, { name: "Kien browser check", suspended: false, operator: true, expectedVersion: 7 });
    assert.equal(patch.headers.get("x-csrf-token"), "fixture-csrf");
    await writeFile(join(evidence, "users-results.json"), JSON.stringify({
      surface: "actual React against explicit fixture API", measurements,
      mutation: { path: patch.path, body: patch.body },
    }, null, 2));
    console.log("PASS users table, responsive themes, automatic version and protected mutation");
  } finally {
    await browser?.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
    console.log(`CLEANUP users browser/profile/fixture: ${profile}`);
  }
}
