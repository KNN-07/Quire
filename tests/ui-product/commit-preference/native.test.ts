import { expect, test } from "bun:test";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticateApi, nextApplicationEvent, projectDocument, startEditorApplication, startEditorBrowser } from "../../ui-editor/shared";
import { openSurface, surfaceSignal } from "../../ui-editor/assembly/actual-browser";
import { raw, run } from "../../../services/core/git/process";
import { CoreProjects, repositoryPath } from "../../../services/core/base";

const evidence = resolve("docs/evidence/p61-commit-preference", crypto.randomUUID());
const inputs = [
  "services/core/git/actions.ts", "services/core/git/compile.ts",
  "apps/web/src/features/editor/git/GitPanel.tsx", "apps/web/src/features/editor/git/types.ts",
  "apps/web/src/features/editor/index.tsx", "apps/web/src/features/account/preferences.tsx",
  "tests/core/git/compile.test.ts", "tests/core/git/preference.test.ts",
  "tests/ui-product/commit-preference/native.test.ts", "tests/ui-product/commit-preference/tsconfig.json",
];
function record(kind: string, data: unknown) {
  console.info("P61_NATIVE", JSON.stringify({ utc: new Date().toISOString(), kind, data }));
}
async function fingerprints(phase: string) {
  for (const path of inputs) record("input", { phase, path,
    sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex") });
}
async function removedDirectory(path: string) {
  try { await access(path); return false; } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return true;
    throw cause;
  }
}

test("saved native compile preference gates staged invalid source and permits corrected exact tree", async () => {
  await mkdir(evidence, { recursive: true });
  record("run", { cwd: process.cwd(), runtime: Bun.version, executable: process.execPath, evidence,
    command: "PATH=\"$PWD/node_modules/.bin:$PATH\" bun test tests/ui-product/commit-preference/native.test.ts" });
  await fingerprints("before");
  const resources = new AsyncDisposableStack();
  const app = resources.use(await startEditorApplication());
  const browser = resources.use(await startEditorBrowser());
  record("owned", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin });
  try {
    const actor = await authenticateApi(app);
    const context = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
    resources.defer(() => context.close());
    await context.addCookies([actor.cookie]);
    const page = await context.newPage();
    page.on("pageerror", error => record("page-error", error.message));
    const path = `/projects/${fixtureIds.project}`;
    const scope = { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile };
    await openSurface(page, { path: "/settings/git", selector: 'input[name="compileBeforeCommit"]' });
    const preference = page.getByRole("checkbox", { name: "Compile before every commit", exact: true });
    expect(await preference.isChecked()).toBe(false);
    await preference.check();
    const saving = page.waitForResponse(response => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === endpoints.preferencesPatch.path);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    const saved = await saving;
    const savedBody: unknown = await saved.json();
    expect(saved.status()).toBe(200);
    expect(editorValue(resultSchema(endpoints.preferencesPatch.output).parse(savedBody)).compileBeforeCommit).toBe(true);
    record("native-preference-save", { url: saved.url(), status: saved.status(), body: savedBody, request: saved.request().postData() });

    // Initialize named history before editing the fixture's real source.
    const statusUrl = `/api/projects/${fixtureIds.project}/git/status?branch=main`;
    const baseline = await actor.http.get(statusUrl.slice(1));
    expect(baseline.status).toBe(200);
    const initial = editorValue(resultSchema(endpoints.gitStatus.output).parse(await baseline.json()));
    await openSurface(page, { path: `${path}/edit`, selector: '.qe-main .cm-content[contenteditable="true"]' });
    const original = (await projectDocument(context, scope)).text;
    const invalid = original.replace("\\end{document}", "\\MissingPreferenceCommand\n\\end{document}");
    for (const [valid, text] of [[false, invalid], [true, original + "\n% corrected preference commit\n"]] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openSurface(page, { path: `${path}/edit`, selector: '.qe-main .cm-content[contenteditable="true"]' });
      const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
      using persisted = nextApplicationEvent(app, event => event.topic === "document.saved"
        && event.aggregateId === fixtureIds.project && event.payload.resourceId === fixtureIds.mainFile);
      await source.press("ControlOrMeta+A");
      await Promise.all([persisted.promise, page.keyboard.insertText(text)]);
      expect((await projectDocument(context, scope)).text).toBe(text);
      await openSurface(page, { path: `${path}/git`, selector: ".git-workspace" });
      const gate = page.getByRole("checkbox", { name: "Compile staged tree before commit", exact: true });
      expect(await gate.isChecked()).toBe(true);
      expect(await gate.isDisabled()).toBe(true);
      const staging = page.waitForResponse(response => response.request().method() === "PUT"
        && new URL(response.url()).pathname === `/api/projects/${fixtureIds.project}/git/stage`);
      await page.getByRole("button", { name: "Stage all", exact: true }).click();
      const stagedResponse = await staging;
      const stagedBody: unknown = await stagedResponse.json();
      record("staged", { valid, status: stagedResponse.status(), body: stagedBody });
      expect(stagedResponse.status()).toBe(200);
      const stagedReady = await surfaceSignal(page, '.git-commit button[type="submit"]:not(:disabled)');
      await stagedReady.observed;
      await page.getByRole("textbox", { name: "Commit message", exact: true }).fill(valid ? "Corrected compile preference" : "Invalid compile preference");
      if (!valid) for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
        await page.screenshot({ path: `${evidence}/${width}-${theme}.png` });
        const bounds = await gate.boundingBox();
        expect(bounds).not.toBeNull();
        record("capture", { width, theme, bounds, path: `${evidence}/${width}-${theme}.png` });
      }
      using finished = nextApplicationEvent(app, event => event.topic === "job.changed"
        && event.aggregateId === fixtureIds.project && ["succeeded", "failed", "timeout", "canceled"].includes(event.payload.status), 90_000);
      const committing = page.waitForResponse(response => response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/projects/${fixtureIds.project}/git/commit`, { timeout: 100_000 });
      await page.locator('.git-commit button[type="submit"]').click();
      const [response, event] = await Promise.all([committing, finished.promise]);
      const body: unknown = await response.json();
      expect(response.status()).toBe(valid ? 202 : 409);
      const afterResponse = await actor.http.get(statusUrl.slice(1));
      const after = editorValue(resultSchema(endpoints.gitStatus.output).parse(await afterResponse.json()));
      if (event.topic !== "job.changed") throw new TypeError("Expected compile terminal event");
      const jobResponse = await actor.http.get(`api/compiles/${event.payload.resourceId}`);
      const job = editorValue(resultSchema(endpoints.compileGet.output).parse(await jobResponse.json()));
      expect(job.status).toBe(valid ? "succeeded" : "failed");
      if (valid) {
        const service = app.application.runtime.services.get("projects");
        if (!(service instanceof CoreProjects)) throw new TypeError("Expected project service");
        const committed = await run({ path: repositoryPath(service.context, fixtureIds.project),
          args: ["rev-parse", "main^{tree}"] });
        expect(raw(job.snapshot.tree)).toBe(committed.text);
        expect(after.head).not.toBe(initial.head);
      } else {
        expect(after.head).toBe(initial.head);
        expect(after.staged.length).toBeGreaterThan(0);
        const failure = await surfaceSignal(page, '.git-notice.is-error');
        await failure.observed;
      }
      record("native-commit", { valid, url: response.url(), request: response.request().postData(),
        idempotencyKey: response.request().headers()["idempotency-key"], status: response.status(), body, event, job, after, text,
        sourceSha256: new Bun.CryptoHasher("sha256").update(text).digest("hex") });
      if (!valid) {
        // Staging is immutable: explicitly replace the failed staged bytes before correcting them.
        const unstaging = page.waitForResponse(entry => entry.request().method() === "PUT"
          && new URL(entry.url()).pathname === `/api/projects/${fixtureIds.project}/git/stage`);
        await page.getByRole("button", { name: "Unstage all", exact: true }).click();
        const unstaged = await unstaging;
        record("unstage-failed-tree", { status: unstaged.status(), body: await unstaged.json() });
        expect(unstaged.status()).toBe(200);
      }
    }
    expect(z.array(z.object({ key: z.string() })).parse(await app.application.runtime.db.all(
      "SELECT key FROM core_git_receipts WHERE actor_id=?", [actor.user.id]))).toHaveLength(1);
  } finally {
    await resources.disposeAsync();
    const removed = await removedDirectory(app.dataDir);
    record("cleanup", { root: app.dataDir, removed, web: app.url.origin, api: app.apiUrl.origin,
      browserConnected: browser.browser.isConnected() });
    expect(removed).toBe(true);
    expect(browser.browser.isConnected()).toBe(false);
    await fingerprints("after");
  }
}, 240_000);
