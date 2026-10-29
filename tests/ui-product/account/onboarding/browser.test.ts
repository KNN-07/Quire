import { expect, test } from "bun:test";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { zipSync } from "fflate";
import { endpoints, IdSchema, OnboardingSchema, ProjectSchema } from "@quire/contracts";
import type { Operation, Project } from "@quire/contracts";
import type { Page } from "@playwright/test";
import { responseData } from "../../../ui-integrations/helpers";
import { startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import { startEditorApplication } from "../../../ui-editor/shared/application";
import { authenticateApi } from "../../../ui-editor/shared/api-session";
import { readLocalMail } from "../../../../services/accounts/identity/mail";
import { fixtureIds } from "../../../fixtures/foundation";
import { CoreProjects } from "../../../../services/core/base";

const evidence = resolve(import.meta.dir, "../../../../docs/evidence/p34-onboarding");
type App = Awaited<ReturnType<typeof startEditorApplication>>;
async function capture(page: Page, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    if (width === 390 && /\/projects\/[^/]+\/edit$/u.test(new URL(page.url()).pathname)) {
      for (const title of ["Assistant", "Project tools"]) {
        const drawer = page.getByRole("dialog", { name: title, exact: true });
        if (await drawer.count()) await drawer.getByRole("button", { name: "Close dialog", exact: true }).click();
      }
    }
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => done())));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${width}-${colorScheme}.png`, fullPage: true, animations: "disabled" });
      console.info("ONBOARDING_CAPTURE", { name, width, colorScheme });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
async function change(page: Page, action: () => Promise<unknown>) {
  const [response] = await Promise.all([
    page.waitForResponse(entry => new URL(entry.url()).pathname === endpoints.onboardingSave.path && entry.request().method() === "PATCH"),
    action(),
  ]);
  expect(response.status()).toBe(200);
  await waitForRenderedText(page, "Choices saved to your account.");
}
async function visualReady(page: Page) {
  await page.evaluate(() => new Promise<void>((ready, reject) => {
    const observer = new MutationObserver(check);
    const deadline = setTimeout(() => { observer.disconnect(); reject(new Error("Visual editor did not become writable")); }, 30_000);
    function check() {
      const button = document.querySelector<HTMLButtonElement>(".q-visual-toolbar button");
      if (!button || button.disabled) return;
      observer.disconnect(); clearTimeout(deadline); ready();
    }
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    check();
  }));
}
async function register(page: Page, app: App, name: string, captures = false) {
  const email = `onboarding-${crypto.randomUUID()}@example.test`;
  const password = `onboarding-${crypto.randomUUID()}`;
  await page.goto("/sign-up?step=create", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Full name", { exact: true }).waitFor();
  if (captures) await capture(page, "create");
  await page.getByLabel("Full name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const registered = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.authRegister.path);
  const verifyUrl = page.waitForURL(url => url.pathname === "/sign-up" && url.search === "?step=verify");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  expect((await registered).status()).toBe(200);
  await verifyUrl;
  const denied = await page.context().request.post(endpoints.authLogin.path, { headers: { origin: app.url.origin }, data: { email, password } });
  expect(denied.status()).toBe(403);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel("Verification token", { exact: true }).waitFor();
  expect(await page.getByLabel("Verification token", { exact: true }).inputValue()).toBe("");
  expect(await page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)])))).toEqual({ "quire.onboarding.screen.v1": "verify" });
  if (captures) await capture(page, "verify-resumed");
  const mail = readLocalMail(app.dataDir).find(entry => entry.recipient === email);
  if (!mail) throw new Error("Controlled local mail fixture did not contain the verification link");
  const link = new URL(mail.body.split("\n")[0] ?? "");
  await page.goto(link.pathname + link.search, { waitUntil: "domcontentloaded" });
  const verified = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.authVerifyEmail.path);
  const signInUrl = page.waitForURL(url => url.pathname === "/sign-in" && url.search === "?onboarding=1");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  expect((await verified).status()).toBe(200);
  await signInUrl;
  expect(new URL(page.url()).searchParams.has("token")).toBe(false);
  expect(await page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)])))).toEqual({ "quire.onboarding.screen.v1": "signin" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const signedIn = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.authLogin.path);
  const startUrl = page.waitForURL(url => url.pathname === "/sign-up" && url.search === "?step=start");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const accepted = await signedIn;
  expect(accepted.status()).toBe(200);
  const user = await responseData(accepted, endpoints.authLogin.output);
  await startUrl;
  await waitForRenderedText(page, "Choices saved to your account.");
  console.info("ONBOARDING_REGISTERED", { userId: user.id, verified: true, localMailFixture: true, unverifiedLogin: 403 });
  return user;
}
async function publishTemplate(app: App) {
  const owner = await authenticateApi(app);
  const operator = await authenticateApi(app, "operator@quire.local");
  const ownerHeaders = { cookie: `${owner.cookie.name}=${owner.cookie.value}`, "x-csrf-token": owner.session.csrfToken };
  const operatorHeaders = { cookie: `${operator.cookie.name}=${operator.cookie.value}`, "x-csrf-token": operator.session.csrfToken };
  const post = async (path: string, body: unknown, headers: HeadersInit) => {
    const response = await fetch(new URL(path, app.url), { method: "POST",
      headers: { ...Object.fromEntries(new Headers(headers)), origin: app.url.origin,
        "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    expect(response.status, await response.clone().text()).toBe(200);
    return responseData(response, endpoints.templateCreate.output);
  };
  let template = await post(endpoints.templateCreate.path, {
    name: "D14 published thesis", category: "Thesis", description: "Real source fixture for onboarding",
    license: "MIT", visibility: "public", sourceProjectId: fixtureIds.project,
  }, ownerHeaders);
  template = await post(endpoints.templateSubmit.path.replace(":id", template.templateId), { expectedVersion: template.version }, ownerHeaders);
  template = await post(endpoints.templateApprove.path.replace(":id", template.templateId),
    { expectedVersion: template.version, versionId: template.id }, operatorHeaders);
  template = await post(endpoints.templatePublish.path.replace(":id", template.templateId),
    { expectedVersion: template.version, versionId: template.id }, operatorHeaders);
  expect(template.status).toBe("published");
  console.info("ONBOARDING_PUBLISHED_TEMPLATE", { id: template.id, status: template.status, sourceProjectId: fixtureIds.project });
  return template;
}

test("mounted registration resumes non-secret choices and real blank/template editors; import uses the existing operation flow", async () => {
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await startEditorApplication();
    root = app.dataDir;
    console.info("ONBOARDING_BROWSER_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin });
    await using browser = await startEditorBrowser();
    const template = await publishTemplate(app);
    const context = await browser.browser.newContext({ baseURL: app.url.origin });
    const page = await context.newPage();
    try {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("response", response => {
        if (new URL(response.url()).pathname.startsWith("/api/me/onboarding")) console.info("ONBOARDING_HTTP", {
          method: response.request().method(), path: new URL(response.url()).pathname, status: response.status(),
        });
      });
      const actor = await register(page, app, "D14 Blank Writer", true);
      await change(page, () => page.getByRole("button", { name: "Coursework", exact: true }).click());
      await change(page, () => page.getByLabel("Project name", { exact: true }).fill("D14 real blank"));
      await change(page, () => page.getByLabel("LaTeX experience", { exact: true }).selectOption("source"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "Choices saved to your account.");
      expect(await page.getByRole("button", { name: "Coursework", exact: true }).getAttribute("aria-pressed")).toBe("true");
      expect(await page.getByLabel("Project name", { exact: true }).inputValue()).toBe("D14 real blank");
      expect(await page.getByLabel("Starting point", { exact: true }).inputValue()).toBe("blank");
      expect(await page.getByLabel("LaTeX experience", { exact: true }).inputValue()).toBe("source");
      await capture(page, "choices-resumed");

      const committed = Promise.withResolvers<Project>();
      const keys: string[] = [];
      page.on("request", request => {
        if (new URL(request.url()).pathname === endpoints.projectCreate.path && request.method() === "POST") {
          keys.push(request.headers()["idempotency-key"] ?? "");
        }
      });
      await page.route("**/api/projects", async route => {
        if (route.request().method() !== "POST") { await route.continue(); return; }
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        committed.resolve(await responseData(response, ProjectSchema));
        // Drop a REAL successful response, not replace it with a successful API mock.
        await route.abort("failed");
      });
      const lost = page.waitForEvent("requestfailed", { predicate: request => new URL(request.url()).pathname === endpoints.projectCreate.path });
      await page.getByRole("button", { name: "Create project", exact: true }).click();
      await lost;
      const actual = await committed.promise;
      await page.getByRole("alert").waitFor();
      await page.unroute("**/api/projects");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Resume project creation", exact: true }).waitFor();
      await capture(page, "creation-resumed");
      await page.route("**/api/me/preferences", async route => {
        if (route.request().method() === "PATCH") await route.abort("failed");
        else await route.continue();
      });
      const completed = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.onboardingComplete.path);
      await page.getByRole("button", { name: "Resume project creation", exact: true }).click();
      expect((await completed).status()).toBe(200);
      await page.getByRole("link", { name: "Open created project without changing view", exact: true }).waitFor();
      expect(await page.getByRole("link", { name: "Open created project without changing view", exact: true }).getAttribute("href")).toBe(`/projects/${actual.id}/edit`);
      await capture(page, "created-preference-failure");
      await page.unroute("**/api/me/preferences");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Open created project", exact: true }).waitFor();
      const editor = page.waitForURL(url => url.pathname === `/projects/${actual.id}/edit`);
      await page.getByRole("button", { name: "Open created project", exact: true }).click();
      await editor;
      await page.locator('.cm-content[contenteditable="true"]').first().waitFor();
      expect(await page.locator(".cm-content").first().innerText()).toContain("\\documentclass{article}");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('.cm-content[contenteditable="true"]').first().waitFor();
      const count = z.object({ count: z.number() }).parse(await app.application.runtime.db.get(
        "SELECT COUNT(*) AS count FROM projects WHERE owner_id=? AND name=?", [actor.id, "D14 real blank"]));
      expect(count.count).toBe(1);
      expect(keys.length).toBe(2);
      expect(new Set(keys).size).toBe(1);
      console.info("ONBOARDING_BLANK_EDITOR", { projectId: actual.id, count: count.count, createRequests: keys.length,
        uniqueCreateKeys: new Set(keys).size, reload: true, lostResponseRecovered: true, preferenceFailureRecovered: true });
      await capture(page, "blank-editor");

      await context.clearCookies();
      await register(page, app, "D14 Template Writer");
      await change(page, () => page.getByRole("button", { name: "A thesis", exact: true }).click());
      await change(page, () => page.getByLabel("Project name", { exact: true }).fill("D14 real template"));
      await change(page, () => page.getByLabel("Starting point", { exact: true }).selectOption(template.id));
      await change(page, () => page.getByLabel("LaTeX experience", { exact: true }).selectOption("visual"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "Choices saved to your account.");
      expect(await page.getByLabel("Starting point", { exact: true }).inputValue()).toBe(template.id);
      expect(await page.getByLabel("LaTeX experience", { exact: true }).inputValue()).toBe("visual");
      expect(await page.getByRole("button", { name: "A thesis", exact: true }).getAttribute("aria-pressed")).toBe("true");
      await capture(page, "template-resumed");
      const createdTemplate = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.projectCreate.path && response.request().method() === "POST");
      const templateEditor = page.waitForURL(/\/projects\/[^/]+\/edit$/u);
      await page.getByRole("button", { name: "Create project", exact: true }).click();
      const copied = await responseData(await createdTemplate, ProjectSchema);
      await templateEditor;
      await page.getByRole("region", { name: "Visual editor", exact: true }).waitFor();
      await visualReady(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("region", { name: "Visual editor", exact: true }).waitFor();
      await visualReady(page);
      const projects = app.application.runtime.services.get("projects");
      if (!(projects instanceof CoreProjects)) throw new Error("Native project service missing");
      const copyFiles = (await projects.listFiles({ projectId: copied.id, branch: copied.defaultBranch }))
        .map(file => ({ path: file.path, blob: file.blob }));
      const sourceFiles = (await projects.listFiles({ projectId: fixtureIds.project, branch: "main" }))
        .map(file => ({ path: file.path, blob: file.blob }));
      expect(copyFiles).toEqual(sourceFiles);
      const copiedCount = z.object({ count: z.number() }).parse(await app.application.runtime.db.get(
        "SELECT COUNT(*) AS count FROM projects WHERE owner_id=? AND name=?", [copied.ownerId, "D14 real template"]));
      expect(copiedCount.count).toBe(1);
      console.info("ONBOARDING_TEMPLATE_EDITOR", { projectId: copied.id, templateVersionId: template.id, count: copiedCount.count,
        copiedFiles: copyFiles, view: "visual", reload: true });
      await capture(page, "template-editor");

      await context.clearCookies();
      await register(page, app, "D14 Import Writer");
      await change(page, () => page.getByLabel("Starting point", { exact: true }).selectOption("import"));
      await change(page, () => page.getByLabel("LaTeX experience", { exact: true }).selectOption("source"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Continue to import", exact: true }).waitFor();
      const importer = page.waitForURL(url => url.pathname === "/projects" && url.searchParams.get("new") === "import" && url.searchParams.get("onboarding") === "1");
      await page.getByRole("button", { name: "Continue to import", exact: true }).click();
      await importer;
      const dialog = page.getByRole("dialog", { name: "New project", exact: true });
      await dialog.waitFor();
      const [importDraftSaved] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === endpoints.onboardingImportSave.path && response.request().method() === "PATCH"),
        dialog.getByLabel("Project name", { exact: true }).fill("D14 real import"),
      ]);
      expect(importDraftSaved.status()).toBe(200);
      await page.reload({ waitUntil: "domcontentloaded" });
      await dialog.waitFor();
      expect(await dialog.getByLabel("Project name", { exact: true }).inputValue()).toBe("D14 real import");
      await capture(page, "import-draft-resumed");
      await dialog.getByLabel("Choose file", { exact: true }).setInputFiles({
        name: "d14.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync({
          "main.tex": new TextEncoder().encode("\\documentclass{article}\n\\begin{document}D14 actual import\\end{document}\n"),
        })),
      });
      const uploadKeys: string[] = [];
      const importKeys: string[] = [];
      page.on("request", request => {
        if (request.method() !== "POST") return;
        const path = new URL(request.url()).pathname;
        if (path === endpoints.importUploadCreate.path) uploadKeys.push(request.headers()["idempotency-key"] ?? "");
        if (path === endpoints.importCreate.path) importKeys.push(request.headers()["idempotency-key"] ?? "");
      });
      await page.route("**/api/import-uploads", async route => {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort("failed");
      });
      const uploadLost = page.waitForEvent("requestfailed", { predicate: request => new URL(request.url()).pathname === endpoints.importUploadCreate.path });
      await dialog.getByRole("button", { name: "Upload and create", exact: true }).click();
      await uploadLost;
      await dialog.getByRole("alert").waitFor();
      const frozen = await responseData(await context.request.get(endpoints.onboardingGet.path), OnboardingSchema);
      expect(frozen.importState?.attempt?.upload).toBeNull();
      expect(uploadKeys[0]).toBe(frozen.importState?.attempt?.uploadKey ?? "");
      await page.unroute("**/api/import-uploads");
      await page.reload({ waitUntil: "domcontentloaded" });
      await dialog.getByRole("button", { name: "Resume import", exact: true }).waitFor();
      expect(await dialog.getByLabel("Choose file", { exact: true }).evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
      const staged = await responseData(await context.request.get(endpoints.onboardingGet.path), OnboardingSchema);
      expect(staged.importState?.attempt?.upload?.id).toBeTruthy();
      expect(staged.importState?.attempt?.key).toBe(frozen.importState?.attempt?.key);
      await capture(page, "import-upload-response-recovered");
      const realImport = Promise.withResolvers<Operation>();
      await page.route("**/api/imports", async route => {
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        realImport.resolve(await responseData(response, endpoints.importCreate.output));
        await route.abort("failed");
      });
      const importLost = page.waitForEvent("requestfailed", { predicate: request => new URL(request.url()).pathname === endpoints.importCreate.path });
      await dialog.getByRole("button", { name: "Resume import", exact: true }).click();
      await importLost;
      const operation = await realImport.promise;
      expect(operation.status).toBe("succeeded");
      await dialog.getByRole("alert").waitFor();
      await page.unroute("**/api/imports");
      await page.reload({ waitUntil: "domcontentloaded" });
      await dialog.getByRole("button", { name: "Open imported project", exact: true }).waitFor();
      const completeImport = await responseData(await context.request.get(endpoints.onboardingGet.path), OnboardingSchema);
      expect(completeImport.stage).toBe("complete");
      expect(completeImport.importState?.attempt?.operationId).toBe(operation.id);
      const projectIds = z.array(IdSchema).parse(operation.result?.["projectIds"]);
      expect(projectIds).toHaveLength(1);
      expect(completeImport.projectId).toBe(projectIds[0] ?? null);
      await capture(page, "import-operation");
      const importedId = projectIds[0];
      if (!importedId) throw new Error("Real import project missing");
      const importedEditor = page.waitForURL(url => url.pathname === `/projects/${importedId}/edit`);
      await dialog.getByRole("button", { name: "Open imported project", exact: true }).click();
      await importedEditor;
      await page.locator('.cm-content[contenteditable="true"]').first().waitFor();
      expect(await page.locator(".cm-content").first().innerText()).toContain("D14 actual import");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('.cm-content[contenteditable="true"]').first().waitFor();
      const importCount = z.object({ count: z.number() }).parse(await app.application.runtime.db.get(
        "SELECT COUNT(*) AS count FROM projects WHERE owner_id=? AND name=?", [completeImport.actorId, "D14 real import"]));
      expect(importCount.count).toBe(1);
      expect(uploadKeys).toHaveLength(1);
      expect(importKeys).toEqual([frozen.importState?.attempt?.key ?? ""]);
      console.info("ONBOARDING_IMPORT_EDITOR", { projectId: importedId, operationId: operation.id,
        count: importCount.count, reload: true, existingOperationResultConsumed: true,
        lostUploadResponseRecovered: true, lostImportResponseRecovered: true, uploadKeys, importKeys });
      await capture(page, "import-editor");
      await page.goto("/sign-up?step=start", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Open created project", exact: true }).waitFor();
      expect(await page.getByLabel("Starting point", { exact: true }).inputValue()).toBe("import");
      console.info("ONBOARDING_IMPORT_COMPLETED", { operationId: operation.id, status: operation.status,
        realProjectIds: projectIds, onboardingStage: completeImport.stage });
      await capture(page, "import-continuation");
      expect(errors).toEqual([]);
    } catch (error) {
      console.info("ONBOARDING_BROWSER_FAILURE", { url: page.url(), body: await page.locator("body").innerText() });
      await page.screenshot({ path: `${evidence}/failure-${Date.now()}.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
  expect(await access(root).then(() => true, () => false)).toBe(false);
  console.info("ONBOARDING_BROWSER_CLEANED", { root, exists: false, browser: "closed", web: "closed", api: "closed", adapters: "closed" });
}, 240_000);
