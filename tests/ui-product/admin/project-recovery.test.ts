import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds } from "../../fixtures/foundation";
import { startEditorApplication } from "../../ui-editor/shared/application";
import { authenticateApi } from "../../ui-editor/shared/api-session";
import { startEditorBrowser, waitForRenderedText } from "../../ui-editor/shared/browser";
import type { Response as BrowserResponse } from "@playwright/test";

test("operator restores an actually deleted project through account administration", async () => {
  // Given: a real deleted project whose original source bytes are retained.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  const owner = await authenticateApi(app, "kien@quire.local");
  const project = editorValue(resultSchema(endpoints.projectGet.output).parse(
    await owner.http.get(`api/projects/${fixtureIds.project}?branch=main`).json()));
  const files = editorValue(resultSchema(endpoints.filesList.output).parse(
    await owner.http.get(`api/projects/${project.id}/files?branch=main`).json()));
  const main = files.find(file => file.path === "main.tex");
  if (!main) throw new TypeError("Seeded project main file is missing");
  const fileUrl = `api/projects/${project.id}/files/${main.id}/content?branch=main`;
  const original = new Uint8Array(await owner.http.get(fileUrl).arrayBuffer());
  const deleted = editorValue(resultSchema(endpoints.projectDelete.output).parse(
    await owner.http.delete(`api/projects/${project.id}`, {
      json: { confirmation: project.name, expectedVersion: project.version },
    }).json()));
  const actor = await authenticateApi(app, "operator@quire.local");
  const context = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const responses: BrowserResponse[] = [];
  page.on("response", response => { if (response.url().includes("/api/admin/")) responses.push(response); });
  try {
    await context.addCookies([actor.cookie]);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await page.getByRole("row").filter({ hasText: "kien@quire.local" })
      .getByRole("button", { name: /^Manage / }).click();
    await page.getByLabel("Deleted project", { exact: true }).selectOption(project.id);
    await page.getByRole("button", { name: "Review project recovery", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Recover deleted project", exact: true });
    expect(await dialog.getByRole("button", { name: "Restore project", exact: true }).isDisabled()).toBe(true);
    await dialog.getByLabel("Project name confirmation", { exact: true }).fill(project.name);
    await mkdir("docs/evidence/p3-project-recovery", { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.screenshot({ path: `docs/evidence/p3-project-recovery/confirm-${width}-${colorScheme}.png` });
      }
    }
    // When: the operator confirms the exact name using the actual recovery route.
    const response = page.waitForResponse(value => value.url().endsWith(`/api/admin/projects/${project.id}/restore`));
    await dialog.getByRole("button", { name: "Restore project", exact: true }).click();
    const restored = editorValue(resultSchema(endpoints.adminProjectRestore.output).parse(await (await response).json()));
    // Then: the owner can reopen identical bytes, and the browser reports the real recovered project.
    expect(restored.version).toBe(deleted.version + 1);
    await waitForRenderedText(page, `${project.name} restored.`);
    expect(Array.from(new Uint8Array(await owner.http.get(fileUrl).arrayBuffer()))).toEqual(Array.from(original));
    expect(errors).toEqual([]);
  } catch (failure) {
    await mkdir("docs/evidence/p3-project-recovery", { recursive: true });
    await page.screenshot({ path: "docs/evidence/p3-project-recovery/failure.png" });
    console.error("RECOVERY_BROWSER_FAILURE", JSON.stringify({ text: await page.locator("body").innerText(),
      responses: await Promise.all(responses.filter(response =>
        response.url().includes("/projects/deleted") || response.status() >= 400).map(async response => ({
        url: response.url(), status: response.status(), body: await response.text(),
      }))) }));
    throw failure;
  } finally {
    await context.close();
  }
}, 180_000);
