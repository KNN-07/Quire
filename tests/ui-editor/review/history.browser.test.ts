import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../fixtures/foundation";
import {
  authenticatedContext, nextApplicationEvent, startEditorApplication, startEditorBrowser, waitForRenderedText,
} from "../shared";
import { authenticateApi } from "../shared/api-session";
import { openPanel, waitForAttribute } from "./browser-harness";

test("labels, compares, downloads and restores a deleted file from real history", async () => {
  // Given: a real file checkpoint followed by deletion, using the actual API and history service.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  const actor = await authenticateApi(app);
  const scope = { projectId: ids.project, branch: "main" };
  using createdHistory = nextApplicationEvent(app, event =>
    event.topic === "history.created" && event.aggregateId === ids.project && event.payload.version === 1);
  const createdResponse = await actor.http.post(`api/projects/${ids.project}/files`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    json: { scope, path: "recover-me.tex", kind: "file", text: "restore this\n", expectedVersion: 0 },
  });
  const created = editorValue(resultSchema(endpoints.fileCreate.output).parse(await createdResponse.json()));
  const historical = await createdHistory.promise;
  if (historical.topic !== "history.created") throw new TypeError("Expected historical checkpoint event");
  using deletedHistory = nextApplicationEvent(app, event =>
    event.topic === "history.created" && event.aggregateId === ids.project && event.payload.version === 2);
  const deletedResponse = await actor.http.delete(`api/projects/${ids.project}/files/${created.id}`, {
    json: { scope, expectedVersion: 1 },
  });
  expect(deletedResponse.status).toBe(200);
  const deleted = await deletedHistory.promise;
  if (deleted.topic !== "history.created") throw new TypeError("Expected deletion checkpoint event");
  console.info("P2U_REVIEW_HISTORY_STAGE", "history-fixture-ready");
  await using owner = await authenticatedContext(browser, app, {
    viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"],
  });
  await using collaborator = await authenticatedContext(browser, app, {
    email: "mai@quire.local", viewport: { width: 1440, height: 900 },
  });
  const page = await owner.context.newPage();
  const collaboratorReview = await collaborator.context.newPage();
  await Promise.all([
    openPanel(page, { view: "history", theme: "dark" }),
    openPanel(collaboratorReview, { view: "review", select: "article" }),
  ]);
  // When: the historical revision containing the now-deleted file is selected.
  const compared = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/history/compare`,
  { timeout: 30_000 });
  await page.locator(`[data-history-id="${historical.payload.resourceId}"]`).click();
  expect((await compared).status()).toBe(200);
  await waitForRenderedText(page, "Deleted now");
  await page.screenshot({
    path: "tests/ui-editor/review/evidence/history-comparison-1440-dark.png", fullPage: true,
  });
  // When: the owner labels, copies, downloads and recovers that file.
  await page.getByLabel("New label").fill("Before deletion");
  const labelled = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/labels")
    && response.request().method() === "POST", { timeout: 30_000 });
  await page.getByRole("button", { name: "Add label" }).click();
  expect((await labelled).status()).toBe(200);
  await page.getByRole("button", { name: "Copy comparison" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("recover-me.tex");
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "Download source ZIP" }).click();
  expect((await download).suggestedFilename()).toContain(String(historical.payload.version));
  await page.getByRole("button", { name: "Recover deleted file" }).click();
  const restored = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/restore")
    && response.request().method() === "POST", { timeout: 30_000 });
  await page.getByRole("button", { name: "Recover file" }).click();
  expect((await restored).status()).toBe(200);
  console.info("P2U_REVIEW_HISTORY_STAGE", "file-recovered");
  // Then: recovery created a new revision and the file survives a workspace reload.
  const files = editorValue(resultSchema(endpoints.filesList.output).parse(await (await actor.http.get(
    `api/projects/${ids.project}/files`, { searchParams: { branch: "main" } },
  )).json()));
  expect(files.some(file => file.path === "recover-me.tex" && file.version.epoch > 0)).toBe(true);
  // When: the complete historical version is restored, the other live editor receives epoch recovery.
  await page.getByRole("button", { name: "Restore selected version" }).click();
  const restoredProject = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/restore")
    && response.request().method() === "POST", { timeout: 30_000 });
  await page.getByRole("button", { name: "Restore version" }).click();
  expect((await restoredProject).status()).toBe(200);
  await waitForAttribute(collaboratorReview, {
    selector: ".review-fixture", name: "data-persistence", value: "recovery",
  });
  console.info("P2U_REVIEW_HISTORY_STAGE", "epoch-recovery-observed");
  await page.reload({ waitUntil: "domcontentloaded" });
  await Promise.all([
    waitForRenderedText(page, "Before deletion"),
    waitForRenderedText(page, "No file differences"),
  ]);
  await using mobileOwner = await authenticatedContext(browser, app, {
    viewport: { width: 390, height: 844 },
  });
  const mobileHistory = await mobileOwner.context.newPage();
  await openPanel(mobileHistory, { view: "history", theme: "light" });
  await waitForRenderedText(mobileHistory, "No file differences");
  await page.screenshot({ path: "tests/ui-editor/review/evidence/history-1440-dark.png", fullPage: true });
  await mobileHistory.screenshot({ path: "tests/ui-editor/review/evidence/history-390-light.png", fullPage: true });
  console.info("P2U_REVIEW_HISTORY_STAGE", "screenshots-written");
}, 300_000);
