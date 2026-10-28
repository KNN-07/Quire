import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { startEditorApplication } from "../../ui-editor/shared/application";
import { authenticateApi } from "../../ui-editor/shared/api-session";
import { startEditorBrowser, waitForRenderedText } from "../../ui-editor/shared/browser";

async function captureDialog(page: Page, name: string) {
  const directory = "docs/evidence/p3-backup-consumer";
  await mkdir(directory, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({ path: `${directory}/${name}-${width}-${colorScheme}.png` });
    }
  }
}

test("operator verifies and restores a real backup through the mounted administration", async () => {
  // Given: real seeded services and a server-issued operator session.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  const actor = await authenticateApi(app, "operator@quire.local");
  const created = await actor.http.post(endpoints.backupCreate.path.slice(1), {
    json: {}, headers: { "idempotency-key": crypto.randomUUID() }, timeout: 120_000,
  });
  const backup = editorValue(resultSchema(endpoints.backupCreate.output).parse(await created.json()));
  expect(backup.status).toBe("succeeded");
  const context = await browser.browser.newContext({ baseURL: app.url.origin });
  try {
    await context.addCookies([actor.cookie]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/admin/storage", { waitUntil: "domcontentloaded" });
    await waitForRenderedText(page, backup.destination);
    const row = page.getByRole("row").filter({ hasText: backup.destination });
    // When: the operator verifies the immutable archive, then restores into a fresh owned target.
    expect(await row.getByRole("button", { name: "Verify", exact: true }).isEnabled()).toBe(true);
    await row.getByRole("button", { name: "Verify", exact: true }).click();
    await captureDialog(page, "verify");
    const verifiedResponse = page.waitForResponse(response => response.url().endsWith(`/${backup.id}/verify`));
    await page.getByRole("dialog").getByRole("button", { name: "Verify backup", exact: true }).click();
    const verified = editorValue(resultSchema(endpoints.backupVerify.output).parse(await (await verifiedResponse).json()));
    expect(verified.status).toBe("succeeded");
    await waitForRenderedText(page, "Verification request: succeeded.");
    await row.getByRole("button", { name: "Restore", exact: true }).click();
    const target = join(app.dataDir, "restores", "browser-proof");
    await page.getByLabel("Isolated restore directory").fill(target);
    await page.getByRole("checkbox").check();
    await captureDialog(page, "restore");
    const restoredResponse = page.waitForResponse(response => response.url().endsWith(`/${backup.id}/restore`), { timeout: 120_000 });
    await page.getByRole("button", { name: "Restore to target", exact: true }).click();
    const restored = editorValue(resultSchema(endpoints.backupRestore.output).parse(await (await restoredResponse).json()));
    // Then: the real recovery operation succeeds without a list ETag or fabricated confirmation.
    expect(restored.status).toBe("succeeded");
    expect(restored.result?.["destination"]).toBe(target);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
}, 180_000);
