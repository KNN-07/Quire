import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { disposePage, mount, responseAfter } from "./helpers";

async function captureSettingsBody(page: Page) {
  let body: unknown;
  await page.route(`**/api/projects/${fixtureIds.project}`, async route => {
    if (route.request().method() === "PATCH") body = route.request().postDataJSON();
    await route.continue();
  });
  return () => endpoints.projectPatch.input.shape.body.parse(body);
}

describe("real editor tool authorization and failures", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  beforeAll(async () => {
    try { app = resources.use(await startEditorApplication()); browser = resources.use(await startEditorBrowser()); }
    catch (error) { await resources.disposeAsync(); throw error; }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    console.info("TOOLS_ACCESS_CLOSED", { api: app.apiUrl.origin, web: app.url.origin, root: app.dataDir });
  }, 30_000);
  test("denies project mutations when the actor is a Viewer", async () => {
    // Given the real seeded Viewer session.
    await using actor = await authenticatedContext(browser, app, { email: "alex@quire.local" });
    const page = await actor.context.newPage();
    await mount(page, fixtureIds.project);
    // When the Viewer opens file commands and attempts a direct server mutation.
    expect(await page.getByRole("button", { name: "New file", exact: true }).isDisabled()).toBe(true);
    const scope = { projectId: fixtureIds.project, branch: "main" };
    const response = await actor.context.request.post(`/api/projects/${scope.projectId}/files`, {
      headers: { origin: app.url.origin, "idempotency-key": crypto.randomUUID(), "x-csrf-token": actor.session.csrfToken },
      data: { scope, path: "viewer-denied.tex", kind: "file", text: "Denied", expectedVersion: 0 },
    });
    // Then UI and server both deny writing without fabricating a successful result.
    expect(response.status()).toBe(403);
    const rejected = resultSchema(endpoints.fileCreate.output).parse(await response.json());
    expect("error" in rejected && rejected.error.code).toBe("FORBIDDEN");
    await page.getByLabel("Editor tool", { exact: true }).selectOption("settings");
    await waitForRenderedText(page, "Save project settings");
    expect(await page.getByRole("button", { name: "Save project settings" }).isDisabled()).toBe(true);
    await page.getByLabel("Editor tool", { exact: true }).selectOption("symbols");
    expect(await page.getByRole("button", { name: "Insert \\alpha", exact: true }).isDisabled()).toBe(true);
    await disposePage(page);
  }, 60_000);
  test("keeps server errors visible when a path conflicts", async () => {
    // Given the owner's real tree containing main.tex.
    await using actor = await authenticatedContext(browser, app);
    const page = await actor.context.newPage();
    await mount(page, fixtureIds.project);
    await page.getByRole("button", { name: "New file", exact: true }).click();
    await page.getByLabel("Project path").fill("main.tex");
    // When the duplicate path is submitted.
    const response = await responseAfter(page, { path: `/api/projects/${fixtureIds.project}/files`, method: "POST" }, () =>
      page.getByRole("button", { name: "Create", exact: true }).click());
    const result = resultSchema(endpoints.fileCreate.output).parse(await response.json());
    if (!("error" in result)) throw new TypeError("Expected duplicate path error");
    await waitForRenderedText(page, result.error.message);
    // Then the unchanged tree and form preserve the user's attempted path.
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(await page.getByLabel("Project path").inputValue()).toBe("main.tex");
    expect(await page.getByRole("dialog").count()).toBe(1);
    const filesResponse = await actor.context.request.get(`/api/projects/${fixtureIds.project}/files`, { params: { branch: "main" } });
    const files = editorValue(resultSchema(endpoints.filesList.output).parse(await filesResponse.json()));
    expect(files.filter(file => file.path === "main.tex").length).toBe(1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await disposePage(page);
  }, 60_000);
  test.each([1440, 390])("renames as Owner while preserving Editor compiler settings at width %i", async width => {
    // Given an actual owner and an actual Editor of the seeded project.
    const options = { viewport: { width, height: width === 390 ? 844 : 900 },
      ...(width === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) };
    await using owner = await authenticatedContext(browser, app, options);
    const ownerPage = await owner.context.newPage();
    await mount(ownerPage, fixtureIds.project);
    await ownerPage.getByLabel("Editor tool", { exact: true }).selectOption("settings");
    await waitForRenderedText(ownerPage, "Installed");
    const name = `Owner renamed project ${width}`;
    await ownerPage.getByLabel("Project name", { exact: true }).fill(name);
    const ownerBody = await captureSettingsBody(ownerPage);
    // When the owner renames through the real settings form.
    const renamed = await responseAfter(ownerPage, { path: `/api/projects/${fixtureIds.project}`, method: "PATCH" }, () =>
      ownerPage.getByRole("button", { name: "Save project settings" }).click());
    expect(editorValue(resultSchema(endpoints.projectPatch.output).parse(await renamed.json())).name).toBe(name);
    expect(ownerBody().name).toBe(name);
    await waitForRenderedText(ownerPage, "Project settings saved.");
    await ownerPage.screenshot({ path: fileURLToPath(new URL(`./evidence/settings-owner-${width}-light.png`, import.meta.url)), fullPage: true });
    await ownerPage.emulateMedia({ colorScheme: "dark" });
    await ownerPage.screenshot({ path: fileURLToPath(new URL(`./evidence/settings-owner-${width}-dark.png`, import.meta.url)), fullPage: true });
    await disposePage(ownerPage);
    await using editor = await authenticatedContext(browser, app, { ...options, email: "mai@quire.local" });
    const page = await editor.context.newPage();
    await mount(page, fixtureIds.project);
    await page.getByLabel("Editor tool", { exact: true }).selectOption("settings");
    await waitForRenderedText(page, "Installed");
    expect(await page.getByLabel("Project name", { exact: true }).count()).toBe(0);
    const draft = width === 1440;
    await page.getByLabel("Draft mode (skip figure rendering)").setChecked(draft);
    const editorBody = await captureSettingsBody(page);
    const changed = await responseAfter(page, { path: `/api/projects/${fixtureIds.project}`, method: "PATCH" }, () =>
      page.getByRole("button", { name: "Save project settings" }).click());
    const body = editorBody();
    expect("name" in body).toBe(false);
    const project = editorValue(resultSchema(endpoints.projectPatch.output).parse(await changed.json()));
    expect(project.name).toBe(name); expect(project.settings.draft).toBe(draft);
    await waitForRenderedText(page, "Project settings saved.");
    await page.screenshot({ path: fileURLToPath(new URL(`./evidence/settings-editor-${width}-light.png`, import.meta.url)), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: fileURLToPath(new URL(`./evidence/settings-editor-${width}-dark.png`, import.meta.url)), fullPage: true });
    await disposePage(page);
    // Then fresh owner and Editor workspaces retain the actual name and settings.
    await mount(page, fixtureIds.project);
    await page.getByLabel("Editor tool", { exact: true }).selectOption("settings");
    await waitForRenderedText(page, "Installed");
    expect(await page.getByLabel("Draft mode (skip figure rendering)").isChecked()).toBe(draft);
    expect(await page.getByLabel("Project name", { exact: true }).count()).toBe(0);
    await disposePage(page);
    await mount(ownerPage, fixtureIds.project);
    await ownerPage.getByLabel("Editor tool", { exact: true }).selectOption("settings");
    await waitForRenderedText(ownerPage, "Installed");
    expect(await ownerPage.getByLabel("Project name", { exact: true }).inputValue()).toBe(name);
    await disposePage(ownerPage);
  }, 120_000);
});
