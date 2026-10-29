import { expect, test } from "bun:test";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import { endpoints, OnboardingSchema } from "@quire/contracts";
import { startEditorApplication } from "../../../ui-editor/shared/application";
import { authenticateApi } from "../../../ui-editor/shared/api-session";
import { startEditorBrowser } from "../../../ui-editor/shared/browser";
import { responseData } from "../../../ui-integrations/helpers";

test("recovered real import keeps its footer inside the desktop and mobile dialog", async () => {
  const evidence = resolve(import.meta.dir, "../../../../docs/evidence/p34-onboarding");
  await mkdir(evidence, { recursive: true });
  await using resources = new AsyncDisposableStack();
  const app = await startEditorApplication();
  resources.defer(async () => {
    expect(await access(app.dataDir).then(() => true, () => false)).toBe(false);
    console.info("ONBOARDING_LAYOUT_CLEANED", { root: app.dataDir, exists: false });
  });
  resources.use(app);
  console.info("ONBOARDING_LAYOUT_OWNED", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin });
  const identity = await authenticateApi(app);
  const browser = resources.use(await startEditorBrowser());
  const context = await browser.browser.newContext({ baseURL: app.url.origin });
  resources.defer(() => context.close());
  await context.addCookies([identity.cookie]);
  const headers = { origin: app.url.origin, "x-csrf-token": identity.session.csrfToken };
  const post = (path: string, data: unknown, key: string = crypto.randomUUID()) =>
    context.request.post(path, { headers: { ...headers, "idempotency-key": key }, data });
  let progress = await responseData(await context.request.get(endpoints.onboardingGet.path), OnboardingSchema);
  progress = await responseData(await context.request.patch(endpoints.onboardingSave.path, {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: { actorId: progress.actorId, expectedVersion: progress.version,
      choices: { ...progress.choices, name: "Original setup name", origin: { kind: "import" } } },
  }), OnboardingSchema);
  progress = await responseData(await post(endpoints.onboardingStart.path,
    { actorId: progress.actorId, expectedVersion: progress.version }), OnboardingSchema);
  if (!progress.importState) throw new Error("Import draft missing");
  progress = await responseData(await context.request.patch(endpoints.onboardingImportSave.path, {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: { actorId: progress.actorId, expectedVersion: progress.version,
      draft: { ...progress.importState.draft, name: "Recovered import layout" } },
  }), OnboardingSchema);
  const bytes = zipSync({ "main.tex": new TextEncoder().encode("\\documentclass{article}\n\\begin{document}Layout fixture\\end{document}\n") });
  progress = await responseData(await post(endpoints.onboardingImportStart.path, {
    actorId: progress.actorId, expectedVersion: progress.version,
    file: { filename: "layout.zip", mime: "application/zip", bytes: bytes.length,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") },
  }), OnboardingSchema);
  const uploadKey = progress.importState?.attempt?.uploadKey;
  if (!uploadKey) throw new Error("Saved upload key missing");
  const uploaded = await context.request.post(endpoints.importUploadCreate.path, {
    headers: { ...headers, "idempotency-key": uploadKey },
    multipart: { file: { name: "layout.zip", mimeType: "application/zip", buffer: Buffer.from(bytes) } },
  });
  expect(uploaded.status()).toBe(201);
  const recovered = await responseData(await post(endpoints.onboardingImportRecover.path,
    { actorId: progress.actorId }), endpoints.onboardingImportRecover.output);
  const attempt = recovered.progress.importState?.attempt;
  if (!attempt?.request) throw new Error("Frozen import request missing");
  const imported = await post(endpoints.importCreate.path, attempt.request, attempt.key);
  expect(imported.status()).toBe(202);
  const operation = await responseData(imported, endpoints.importCreate.output);
  expect(operation.status).toBe("succeeded");
  const page = await context.newPage();
  await page.goto("/projects?new=import&onboarding=1", { waitUntil: "domcontentloaded" });
  const dialog = page.getByRole("dialog", { name: "New project", exact: true });
  await dialog.getByRole("button", { name: "Open imported project", exact: true }).waitFor();
  for (const width of [1440, 390]) {
    const height = width === 390 ? 844 : 900;
    await page.setViewportSize({ width, height });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise<void>(ready => requestAnimationFrame(() => ready())));
      await page.screenshot({ path: `${evidence}/import-operation-footer-${width}-${colorScheme}.png`, fullPage: true, animations: "disabled" });
      const modal = await dialog.boundingBox();
      const cancel = await dialog.getByRole("button", { name: "Cancel", exact: true }).boundingBox();
      const resume = await dialog.getByRole("button", { name: "Resume import", exact: true }).boundingBox();
      if (!modal || !cancel || !resume) throw new Error("Dialog or footer bounds missing");
      console.info("ONBOARDING_LAYOUT_BOUNDS", { width, height, colorScheme, modal, cancel, resume, operationId: operation.id });
      expect(cancel.y + cancel.height).toBeLessThanOrEqual(Math.min(modal.y + modal.height, height) + 1);
      expect(resume.y + resume.height).toBeLessThanOrEqual(Math.min(modal.y + modal.height, height) + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.goto("/sign-up?step=start", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open created project", exact: true }).waitFor();
  expect(await page.getByLabel("Project name", { exact: true }).inputValue()).toBe(attempt.request.name);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise<void>(ready => requestAnimationFrame(() => ready())));
      await page.screenshot({ path: `${evidence}/import-complete-name-${width}-${colorScheme}.png`, fullPage: true, animations: "disabled" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
}, 120_000);
