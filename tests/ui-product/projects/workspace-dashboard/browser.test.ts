import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import type { Page } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { CoreProjects } from "../../../../services/core/base";
import { fixtureIds as ids } from "../../../fixtures/foundation";
import { workspaceProjects } from "../../../core/workspace-dashboard/fixture";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, openProjects, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";

test("real dashboard changes workspace, resets hidden selections and pages, reloads and navigates", async () => {
  const evidence = "docs/evidence/p28-workspace-dashboard/final";
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("WORKSPACE_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin });
    const service = app.application.runtime.services.get("projects");
    if (!(service instanceof CoreProjects)) throw new Error("Expected native project service");
    const data = await workspaceProjects(service);
    for (let index = 1; index <= 48; index++) {
      await service.create(ids.kien, { name: `Workspace page ${String(index).padStart(2, "0")}`, workspaceId: ids.team, origin: { kind: "blank" } });
    }
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 1000 } });
    const page = await owner.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const all = await openProjects(page);
    expect(all.items).toHaveLength(50);
    await page.getByRole("combobox", { name: "Workspace", exact: true }).waitFor();
    await page.getByRole("option", { name: "Quire Institute (institution)", exact: true }).waitFor({ state: "attached" });
    expect(await page.getByRole("option").allTextContents()).toContain("Robotics Lab (team)");
    const personal = await changeWorkspace(page, "personal");
    expect(personal.items.map(row => row.id).sort()).toEqual([data.personal.id, data.shared.id].sort());
    await rowsEqual(page, personal.items.map(row => row.name));
    await selectAndRead(page, "Sort by", "title", url => url.searchParams.get("sort") === "title");
    await selectAndRead(page, "Direction", "asc", url => url.searchParams.get("direction") === "asc");
    const team = await changeWorkspace(page, ids.team);
    expect(team.items).toHaveLength(50);
    expect(team.items.some(row => row.id === data.teamHidden.id)).toBe(false);
    await rowsEqual(page, team.items.map(row => row.name));
    await page.getByRole("checkbox", { name: "Select all projects on this page", exact: true }).check();
    await waitForRenderedText(page, "50 selected");
    const next = await projectResponse(page, () => page.getByRole("button", { name: "Next page", exact: true }).click(),
      url => url.searchParams.get("workspace") === ids.team && url.searchParams.has("cursor"));
    expect(next.items.map(row => row.id)).toEqual([data.team.id]);
    expect(next.nextCursor).toBeNull();
    await rowsEqual(page, [data.team.name]);
    expect(await page.getByLabel("Selected projects", { exact: true }).count()).toBe(0);
    await page.getByRole("checkbox", { name: `Select ${data.team.name}`, exact: true }).check();
    const reset = await changeWorkspace(page, "personal");
    expect(reset.items).toHaveLength(2);
    await rowsEqual(page, reset.items.map(row => row.name));
    expect(await page.getByRole("button", { name: "First page", exact: true }).count()).toBe(0);
    expect(await page.getByLabel("Selected projects", { exact: true }).count()).toBe(0);
    const reload = await projectResponse(page, () => page.reload({ waitUntil: "domcontentloaded" }),
      url => url.searchParams.get("workspace") === "personal" && !url.searchParams.has("cursor"));
    await rowsEqual(page, reload.items.map(row => row.name));
    expect(await page.getByRole("combobox", { name: "Workspace", exact: true }).inputValue()).toBe("personal");
    const back = await projectResponse(page, () => page.goBack({ waitUntil: "domcontentloaded" }),
      url => url.searchParams.get("workspace") === ids.team && !url.searchParams.has("cursor"));
    expect(back.items).toHaveLength(50);
    await rowsEqual(page, back.items.map(row => row.name));
    await changeWorkspace(page, "personal");
    await rowsEqual(page, [data.personal.name, data.shared.name]);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        const geometry = await page.evaluate(() => {
          const workspace = document.querySelector('select[aria-label="Workspace"]')?.getBoundingClientRect();
          const search = document.querySelector('input[type="search"]')?.getBoundingClientRect();
          if (!workspace || !search) throw new Error("Header controls missing");
          return {
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            workspace: { x: workspace.x, right: workspace.right, y: workspace.y, bottom: workspace.bottom },
            search: { x: search.x, right: search.right, y: search.y, bottom: search.bottom },
            overlap: workspace.left < search.right && workspace.right > search.left && workspace.top < search.bottom && workspace.bottom > search.top,
          };
        });
        expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
        expect(geometry.workspace.right).toBeLessThanOrEqual(width);
        expect(geometry.overlap).toBe(false);
        console.info("WORKSPACE_GEOMETRY", { colorScheme, ...geometry });
        await page.screenshot({ path: `${evidence}/inspect${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    const institution = await changeWorkspace(page, ids.institution);
    expect(institution.items.map(row => row.id)).toEqual([data.institution.id]);
    await rowsEqual(page, [data.institution.name]);
    await changeWorkspace(page, "personal");
    const navigated = page.waitForURL(`**/projects/${data.personal.id}/edit`);
    await page.getByRole("button", { name: data.personal.name, exact: true }).click();
    await navigated;
    await waitForRenderedText(page, data.personal.name);
    const unknown = crypto.randomUUID();
    const denied = page.waitForResponse(response => new URL(response.url()).pathname === "/api/projects"
      && new URL(response.url()).searchParams.get("workspace") === unknown);
    await page.goto(`/projects?workspace=${unknown}`, { waitUntil: "domcontentloaded" });
    expect((await denied).status()).toBe(404);
    await waitForRenderedText(page, "NOT_FOUND: Workspace not found");
    expect(await page.locator(".p-project-title").count()).toBe(0);
    expect(await page.getByRole("combobox", { name: "Workspace", exact: true }).inputValue()).toBe(unknown);
    await using viewer = await authenticatedContext(browser, app, { email: "alex@quire.local" });
    const viewerPage = await viewer.context.newPage();
    const viewerWorkspaceResponse = viewerPage.waitForResponse(response => new URL(response.url()).pathname === "/api/project-workspaces");
    const shared = await openProjects(viewerPage);
    expect(shared.items.map(row => row.id)).toEqual([ids.project]);
    await rowsEqual(viewerPage, ["Latent Dynamics Note"]);
    await viewerPage.getByRole("combobox", { name: "Workspace", exact: true }).waitFor();
    const viewerWorkspaces = await viewerWorkspaceResponse;
    expect(editorValue(resultSchema(endpoints.projectWorkspaces.output).parse(await viewerWorkspaces.json()))).toEqual({ items: [], nextCursor: null });
    expect(await viewerPage.getByRole("combobox", { name: "Workspace", exact: true }).locator("option").allTextContents())
      .toEqual(["All workspaces", "Personal projects (no workspace)"]);
    const forbidden = await viewer.context.request.get(`/api/projects?workspace=${ids.team}&limit=1&cursor=${ids.project}`);
    expect(forbidden.status()).toBe(404);
    expect(resultSchema(endpoints.projectList.output).parse(await forbidden.json())).toMatchObject({ error: { code: "NOT_FOUND", message: "Workspace not found" } });
    expect(errors).toEqual([]);
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("WORKSPACE_CLOSED", { root, evidence });
}, 180_000);

async function changeWorkspace(page: Page, workspace: string) {
  const result = await projectResponse(page,
    () => page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption(workspace),
    url => url.searchParams.get("workspace") === workspace && !url.searchParams.has("cursor"));
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(workspace);
  console.info("WORKSPACE_QUERY", { workspace, rows: result.items.map(row => row.name), nextCursor: result.nextCursor });
  return result;
}
async function selectAndRead(page: Page, label: string, option: string, matches: (url: URL) => boolean) {
  return projectResponse(page, () => page.getByRole("combobox", { name: label, exact: true }).selectOption(option), matches);
}
async function projectResponse(page: Page, trigger: () => Promise<unknown>, matches: (url: URL) => boolean) {
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === "/api/projects"
    && entry.request().method() === "GET" && matches(new URL(entry.url())), { timeout: 30_000 });
  await trigger();
  const resolved = await response;
  expect(resolved.status()).toBe(200);
  return editorValue(resultSchema(endpoints.projectList.output).parse(await resolved.json()));
}
async function rowsEqual(page: Page, names: readonly string[]) {
  await page.evaluate(expected => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { observer.disconnect(); reject(new Error("Exact project rows did not settle")); }, 30_000);
    const observer = new MutationObserver(check);
    function check() {
      const rendered = [...document.querySelectorAll(".p-project-title")].map(node => node.textContent ?? "").sort();
      if (JSON.stringify(rendered) !== JSON.stringify([...expected].sort())) return;
      observer.disconnect(); clearTimeout(timeout); resolve();
    }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    check();
  }), names);
}
