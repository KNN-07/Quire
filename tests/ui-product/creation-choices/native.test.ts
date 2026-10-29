import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { zipSync } from "fflate";
import { AdapterGrantSchema, endpoints, IdSchema, resultSchema } from "@quire/contracts";
import type { Project } from "@quire/contracts";
import { z } from "zod";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { seedStarterTemplate } from "../../../scripts/seed-template";
import { githubFixture } from "../../adapters/remote-git/provider-fixture";
import { startAssemblyApplication } from "../../ui-editor/assembly/application";
import { openSurface, surfaceSignal } from "../../ui-editor/assembly/actual-browser";
import { authenticateApi, nextApplicationEvent, projectDocument, startEditorBrowser } from "../../ui-editor/shared";
import { assertChoicesLocked, captureCreation } from "./presentation";

test("native template ZIP GitHub and Git creation retain explicit choices and real source", async () => {
  const evidence = `docs/evidence/p69-import-choices/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root: string;
  {
    await using provider = await githubFixture();
    const http = new SafeHttpClient({ fixtureOrigins: [provider.origin] });
    await using app = await startAssemblyApplication({ http, remoteGit: { fixtureOrigins: [provider.origin] } });
    let held: { enter: () => void; release: Promise<void> } | undefined;
    const handle = app.application.handle;
    app.application.handle = async (request, server) => {
      const gate = held;
      const path = new URL(request.url).pathname;
      if (gate && request.method === "POST" && (path === endpoints.projectCreate.path || path === endpoints.importCreate.path)) {
        held = undefined; gate.enter(); await gate.release;
      }
      return handle(request, server);
    };
    await using browser = await startEditorBrowser();
    root = app.dataDir;
    await seedStarterTemplate(app.application.runtime);
    const owner = await authenticateApi(app);
    const operator = await authenticateApi(app, "operator@quire.local");
    const context = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const failures: unknown[] = [];
    console.info("P69_NATIVE_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, provider: provider.origin, evidence });
    try {
      await context.addCookies([owner.cookie]);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const dialog = page.getByRole("dialog", { name: "New project", exact: true });
      const open = async (tab: string) => {
        await page.goto("/projects", { waitUntil: "domcontentloaded" });
        const grants = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.connectionsList.path);
        const environments = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.environmentsAdmission.path);
        await Promise.all([grants, environments, page.getByRole("button", { name: "New project", exact: true }).first().click()]);
        await dialog.getByRole("tab", { name: tab, exact: true }).click();
        await (await surfaceSignal(page, 'select[aria-label="TeX Live version"]:not(:has(option[value=""]))')).observed;
      };
      await open("Import from GitHub");
      expect(await dialog.getByRole("button", { name: "Import repository", exact: true }).isDisabled()).toBe(true);
      expect(await dialog.getByRole("combobox", { name: "Saved connection", exact: true }).inputValue()).toBe("");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      for (const kind of ["github", "git"] as const) {
        expect((await operator.http.put(`api/admin/providers/${kind}`, { headers: { "if-match": '"0"' }, json: {
          baseUrl: provider.origin, model: `remote-git-${kind}-client`, secret: `remote-git-${kind}-secret`,
          policy: defaultPolicy, expectedVersion: 0,
        } })).status).toBe(200);
      }
      const started = z.object({ data: z.object({ url: z.string() }) }).parse(await (await owner.http.post(
        "api/connections/github/start", { json: { returnTo: "/settings/connections" } })).json());
      const authorized = await fetch(started.data.url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      const location = authorized.headers.get("location");
      if (!location) throw new Error("Owned provider callback required");
      const callback = new URL(location);
      expect((await owner.http.get(`${callback.pathname.slice(1)}${callback.search}`, { redirect: "manual" })).status).toBe(303);
      const connections = editorValue(resultSchema(endpoints.connectionsList.output).parse(await (await owner.http.get("api/connections")).json()));
      const github = connections.items.find(item => item.provider === "github");
      const secret = provider.tokens[0];
      if (!github || !secret) throw new Error("Real saved provider connection required");
      const git = z.object({ data: AdapterGrantSchema }).parse(await (await owner.http.post("api/connections/git/credentials", {
        json: { label: "Owned repository", url: `${provider.origin}/owner/research.git`, username: "git", secret },
      })).json()).data;
      const records: unknown[] = [];
      for (const kind of ["template", "zip", "github", "git"] as const) {
        const tab = { template: "From template", zip: "Upload .zip", github: "Import from GitHub", git: "Clone git URL" }[kind];
        await open(tab);
        await dialog.getByLabel("Project name", { exact: true }).fill(`Explicit ${kind} choices`);
        if (kind === "template") await dialog.getByRole("button", { name: /^Select template / }).first().click();
        const mainPath = kind === "zip" ? "z-selected.tex" : "main.tex";
        const chosen = "\\documentclass{article}\n\\begin{document}RIGHTIMPORT\\end{document}\n";
        if (kind === "zip") await dialog.getByLabel("Choose file", { exact: true }).setInputFiles({
          name: "choices.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync({
            "main.tex": new TextEncoder().encode("\\documentclass{article}\n\\begin{document}WRONGIMPORT\\end{document}\n"),
            [mainPath]: new TextEncoder().encode(chosen),
          })),
        });
        if (kind === "github" || kind === "git") {
          await dialog.getByLabel("Repository URL", { exact: true }).fill(`${provider.origin}/owner/research.git`);
          await dialog.getByRole("combobox", { name: "Saved connection", exact: true }).selectOption(kind === "github" ? github.id : git.id);
          if (kind === "github") {
            await dialog.getByRole("checkbox", { name: "Import full Git history", exact: true }).uncheck();
            expect(await dialog.getByRole("checkbox", { name: "Keep remote connection for pull and push", exact: true }).isChecked()).toBe(false);
            expect(await dialog.getByRole("checkbox", { name: "Keep remote connection for pull and push", exact: true }).isDisabled()).toBe(true);
          }
        }
        await dialog.getByRole("combobox", { name: "Compiler", exact: true }).selectOption("xelatex");
        await dialog.getByLabel("Main document path (optional)", { exact: true }).fill(mainPath);
        const environmentId = await dialog.getByRole("combobox", { name: "TeX Live version", exact: true }).inputValue();
        expect(IdSchema.safeParse(environmentId).success).toBe(true);
        await captureCreation(page, dialog, kind, evidence);
        const response = page.waitForResponse(entry => entry.request().method() === "POST"
          && new URL(entry.url()).pathname === (kind === "template" ? endpoints.projectCreate.path : endpoints.importCreate.path));
        void response.catch(() => undefined);
        const label = { template: "Create from template", zip: "Upload and create", github: "Import repository", git: "Clone and create" }[kind];
        const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>();
        held = { enter: () => entered.resolve(), release: released.promise };
        const disabled = await surfaceSignal(page, "#new-project-form > .p-form-grid input:disabled");
        try {
          await dialog.getByRole("button", { name: label, exact: true }).click();
          await Promise.all([entered.promise, disabled.observed]);
          await assertChoicesLocked(dialog, kind);
          await page.screenshot({ path: `${evidence}/${kind}-submitted-pending.png` });
        } finally { released.resolve(); held = undefined; }
        const received = await response;
        const body: unknown = await received.json();
        let project: Project;
        if (kind === "template") {
          expect(received.status()).toBe(200);
          project = editorValue(resultSchema(endpoints.projectCreate.output).parse(body));
          await page.waitForURL(`**/projects/${project.id}/edit`);
        } else {
          expect(received.status()).toBe(202);
          const operation = editorValue(resultSchema(endpoints.importCreate.output).parse(body));
          expect(operation.status).toBe("succeeded");
          await (await surfaceSignal(page, 'button[form="new-project-form"]:disabled:not([aria-busy="true"])')).observed;
          await assertChoicesLocked(dialog, kind);
          await page.screenshot({ path: `${evidence}/${kind}-submitted-complete.png` });
          const projectId = IdSchema.parse(operation.result?.["projectId"]
            ?? z.array(IdSchema).parse(operation.result?.["projectIds"])[0]);
          project = editorValue(resultSchema(endpoints.projectGet.output).parse(
            await (await owner.http.get(`api/projects/${projectId}`, { searchParams: { branch: "main" } })).json()));
          const opened = page.waitForURL(`**/projects/${project.id}/edit`);
          await dialog.getByRole("button", { name: "Open imported project", exact: true }).click();
          await opened;
          if (kind === "github" || kind === "git") {
            expect(operation.result?.["preserveHistory"]).toBe(kind === "git");
            expect(operation.result?.["keepConnected"]).toBe(kind === "git");
            const binding = await app.application.runtime.db.get("SELECT id FROM remote_bindings WHERE project_id=?", [project.id]);
            if (kind === "github") expect(binding).toBeNull();
            else expect(binding).toBeTruthy();
          }
        }
        expect(project.settings).toMatchObject({ engine: "xelatex", environmentId });
        await openSurface(page, { path: `/projects/${project.id}/edit`, selector: '.qe-main .cm-content[contenteditable="true"]' });
        const persistedSource = await projectDocument(context, { projectId: project.id, branch: project.defaultBranch, fileId: project.settings.mainFileId });
        expect(persistedSource.file.path).toBe(mainPath);
        expect(await page.getByRole("textbox", { name: `Source: ${mainPath}`, exact: true }).count()).toBe(1);
        if (kind === "zip") {
          expect(persistedSource.text).toBe(chosen);
          await page.getByText("PDF options", { exact: true }).click();
          using completed = nextApplicationEvent(app, event => event.topic === "job.changed"
            && event.aggregateId === project.id && ["succeeded", "failed"].includes(event.payload.status), 90_000);
          const compileResponse = page.waitForResponse(entry => entry.request().method() === "POST"
            && new URL(entry.url()).pathname === endpoints.compileCreate.path.replace(":p", project.id));
          const [submitted] = await Promise.all([compileResponse,
            page.locator(".q-pdf-options").getByRole("button", { name: "Recompile", exact: true }).click()]);
          expect(submitted.status()).toBe(202);
          const queued = editorValue(resultSchema(endpoints.compileCreate.output).parse(await submitted.json()));
          const event = await completed.promise;
          if (event.topic !== "job.changed") throw new Error("Compile event required");
          expect(event.payload.resourceId).toBe(queued.id);
          const job = await app.application.runtime.services.get("compiler").get(owner.user.id, event.payload.resourceId);
          expect(job.status).toBe("succeeded");
          const pdf = job.artifacts.find(item => item.name === "output.pdf");
          if (!pdf) throw new Error("Actual selected-main PDF required");
          await Bun.write(`${evidence}/selected-main.pdf`, await (await context.request.get(`/api/artifacts/${pdf.id}/content`)).body());
          records.push({ kind, status: received.status(), body, project, job, source: persistedSource.text });
        } else records.push({ kind, status: received.status(), body, project, source: persistedSource.text });
      }
      expect(errors).toEqual([]);
      await Bun.write(`${evidence}/receipt.json`, JSON.stringify({ root, records, errors }, null, 2));
    } catch (error) { failures.push(error); }
    finally {
      const captures = await Promise.allSettled([
        page.content().then(html => Bun.write(`${evidence}/terminal.html`, html)),
        page.screenshot({ path: `${evidence}/terminal.png` }),
      ]);
      for (const result of captures) if (result.status === "rejected") failures.push(result.reason);
      try { await context.close(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Native creation workflow or cleanup failed");
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("P69_NATIVE_CLEANUP", { root, absent: true });
}, 300_000);
