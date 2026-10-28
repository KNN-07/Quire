import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { stat } from "node:fs/promises";
import { endpoints, resultSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticatedContext, startEditorApplication, startEditorBrowser } from "../shared";
import { openSurface, surfaceSignal } from "./actual-browser";

test("shell updates live effective authority without opening Share or replacing the source document", async () => {
  const roots: string[] = [];
  {
    // Given: a genuine Editor session on the mounted route, with Share never opened.
    await using app = await startEditorApplication();
    roots.push(app.dataDir);
    console.log("AUTHORITY_OWNED", { root: app.dataDir, web: app.url.origin });
    await using browser = await startEditorBrowser();
    await using editor = await authenticatedContext(browser, app, {
      email: "mai@quire.local", viewport: { width: 1440, height: 900 },
    });
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    const page = await editor.context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await openSurface(page, { path: `/projects/${fixtureIds.project}/edit`, selector: ".qe-workspace" });
    await page.getByLabel("Editor tool", { exact: true }).selectOption("settings");
    const ready = await surfaceSignal(page, ".editor-tools fieldset:not([disabled]) button[type=submit]:not([disabled])", 15_000);
    await ready.observed;
    const source = await page.locator(".cm-editor").elementHandle();
    if (!source) throw new TypeError("Mounted source editor is missing");
    const save = page.getByRole("button", { name: "Save project settings", exact: true });
    expect(await save.isEnabled()).toBe(true);
    // When: the operator limits all writable collaborator slots.
    const limited = await surfaceSignal(page, ".editor-tools fieldset[disabled]", 15_000);
    const grant = { compileSeconds: 180, writableMembers: 0, historyDays: null, trackChanges: true };
    const setGrant = (expectedVersion: number, writableMembers: number | null) =>
      operator.context.request.put("/api/admin/project-benefits/deployment/local", {
        headers: { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken },
        data: { expectedVersion, benefits: { ...grant, writableMembers } },
      });
    expect((await setGrant(0, 0)).status()).toBe(200);
    await limited.observed;
    // Then: shell-only controls become read-only while the assigned role is retained.
    expect(await save.isDisabled()).toBe(true);
    const response = await editor.context.request.get(`/api/projects/${fixtureIds.project}/effective-access?branch=main`);
    const access = resultSchema(endpoints.projectAccess.output).parse(await response.json());
    if ("error" in access) throw new TypeError(access.error.message);
    expect(access.data.role).toBe("editor");
    expect(access.data.effectiveRole).toBe("viewer");
    const enabled = await surfaceSignal(page, ".editor-tools fieldset:not([disabled])", 15_000);
    expect((await setGrant(1, null)).status()).toBe(200);
    await enabled.observed;
    expect(await save.isEnabled()).toBe(true);
    expect(await source.evaluate(node => node.isConnected)).toBe(true);
    expect(pageErrors).toEqual([]);
  }
  for (const root of roots) await rejects(stat(root), { code: "ENOENT" });
  console.log("AUTHORITY_CLOSED", { roots });
}, 180_000);
