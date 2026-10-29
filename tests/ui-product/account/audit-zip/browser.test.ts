import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { unzipSync } from "fflate";
import { endpoints, resultSchema } from "@quire/contracts";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../../fixtures/foundation";
import type { Download } from "@playwright/test";

test("native organization and operator consumers download real paginated audit ZIP bytes", async () => {
  const evidence = `docs/evidence/p14-audit-zip/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  let web = "";
  let api = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir; web = app.url.origin; api = app.apiUrl.origin;
    console.info("AUDIT_ZIP_OWNED", { root, web, api, evidence });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    const page = await owner.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    // Persist a deterministic 101-entry audit stream; both exports still traverse native HTTP.
    const targetIds: string[] = [];
    for (let index = 0; index < 101; index++) {
      const id = crypto.randomUUID(); targetIds.push(id);
      await app.application.runtime.db.run("INSERT INTO audit_entries(id,at,actor_id,organization_id,event,target_id,details_json) VALUES(?,?,?,?,?,?,?)",
        [id, app.application.runtime.clock.now(), ids.kien, ids.team, index === 0 ? "=SUM(1,2)" : "audit.zip.browser",
          id, JSON.stringify({ token: "browser-secret-never-export", visible: 'café,"quoted"\nline' })]);
    }
    const list = editorValue(resultSchema(endpoints.organizationsList.output).parse(
      await (await owner.context.request.get("/api/organizations?limit=200")).json()));
    const organization = list.items.find(entry => entry.id === ids.team);
    if (!organization) throw new Error("Seeded organization missing");
    await page.goto("/settings/organizations", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: new RegExp(organization.name) }).click();
    await page.getByRole("heading", { name: "Audit history", exact: true }).waitFor();
    const response = page.waitForResponse(entry => entry.request().method() === "POST"
      && new URL(entry.url()).pathname === `/api/organizations/${ids.team}/audit/export`);
    await page.getByRole("button", { name: "Export audit ZIP", exact: true }).click();
    expect((await response).status()).toBe(202);
    const link = page.getByRole("link", { name: "Download audit ZIP", exact: true });
    const href = await link.getAttribute("href");
    if (!href) throw new Error("Native audit download URL missing");
    const downloaded = page.waitForEvent("download");
    await link.click();
    await inspectDownload(await downloaded, `${evidence}/organization-audit.zip`, targetIds, [100, 1]);
    // Attachment navigation emits a download, not a Page response. Verify the native endpoint separately.
    const nativeDownload = await owner.context.request.get(href);
    expect(nativeDownload.status()).toBe(200);
    expect(nativeDownload.headers()["content-type"]).toBe("application/zip");
    expect(new Uint8Array(await nativeDownload.body())).toEqual(
      new Uint8Array(await Bun.file(`${evidence}/organization-audit.zip`).arrayBuffer()));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/organization-${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    const operatorPage = await operator.context.newPage();
    operatorPage.on("pageerror", error => errors.push(error.message));
    await operatorPage.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await operatorPage.getByRole("heading", { name: "Audit log", exact: true }).waitFor();
    const operatorExport = operatorPage.waitForResponse(entry => entry.request().method() === "POST"
      && new URL(entry.url()).pathname === "/api/admin/audit/export");
    const operatorDownload = operatorPage.waitForEvent("download");
    const operatorBytes = operatorPage.waitForResponse(entry => new URL(entry.url()).pathname.endsWith("/download"));
    await operatorPage.getByRole("button", { name: "Export ZIP", exact: true }).click();
    expect((await operatorExport).status()).toBe(202);
    expect((await operatorBytes).status()).toBe(200);
    // The organization export itself adds one audit entry; the operator now sees 102.
    await inspectDownload(await operatorDownload, `${evidence}/operator-audit.zip`, targetIds, [100, 2]);
    await waitForRenderedText(operatorPage, "Audit export downloaded.");
    for (const width of [1440, 390]) {
      await operatorPage.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await operatorPage.emulateMedia({ colorScheme });
        await operatorPage.evaluate(() => document.fonts.ready);
        expect(await operatorPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await operatorPage.screenshot({ path: `${evidence}/operator-${width}-${colorScheme}.png`, fullPage: width !== 390 });
      }
    }
    expect(errors).toEqual([]);
  }
  await rejects(stat(root), { code: "ENOENT" });
  for (const origin of [web, api]) await rejects(fetch(origin, { signal: AbortSignal.timeout(2000) }));
  console.info("AUDIT_ZIP_CLOSED", { root, web, api, evidence, browsers: "closed", servers: "closed", rootAbsent: true });
}, 180_000);

async function inspectDownload(download: Download, path: string, targetIds: readonly string[], counts: readonly number[]) {
  expect(download.suggestedFilename()).toBe("audit.zip");
  await download.saveAs(path);
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  expect([...bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(["audit-0001.csv", "audit-0002.csv"]);
  const texts = Object.values(files).map(file => new TextDecoder().decode(file));
  expect(texts.map(text => [...text.matchAll(/^"\d+",/gm)].length)).toEqual([...counts]);
  expect(texts.every(text => text.startsWith('"sequence","at","actorId","organizationId","event","targetId","details"\r\n'))).toBe(true);
  const targets = texts.flatMap(text => [...text.matchAll(/,"([0-9a-f-]{36})","/g)].map(match => match[1]));
  expect(targetIds.filter(id => targets.includes(id))).toEqual([...targetIds]);
  for (const id of targetIds) expect(texts.join("").split(`"${id}"`)).toHaveLength(2);
  expect(texts.join("")).toContain('"\'=SUM(1,2)"');
  expect(texts.join("")).toContain("[redacted]");
  expect(texts.join("")).not.toContain("browser-secret-never-export");
}
