import { expect, test } from "bun:test";
import { ProposedEditSchema } from "@quire/contracts";
import { CoreProjects } from "../../../services/core/base";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { proposal, sourceDoc } from "../../core/review/harness";
import {
  authenticatedContext, startEditorApplication, startEditorBrowser, waitForRenderedText,
} from "../shared";
import { openPanel } from "./browser-harness";

test("persists proposals across sessions and reload, then renders a real source conflict", async () => {
  // Given: independent Reviewer and Owner sessions subscribed to the same source file.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using owner = await authenticatedContext(browser, app, {
    viewport: { width: 1440, height: 900 },
  });
  await using reviewer = await authenticatedContext(browser, app, {
    email: "sam@quire.local", viewport: { width: 1440, height: 900 },
  });
  const ownerPage = await owner.context.newPage();
  const reviewerPage = await reviewer.context.newPage();
  await Promise.all([
    openPanel(ownerPage, { view: "review", select: "article" }),
    openPanel(reviewerPage, { view: "review", select: "article" }),
  ]);
  // When: the Reviewer creates a proposal through the UI.
  await reviewerPage.getByLabel("Replacement text").fill("report");
  const created = reviewerPage.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/suggestions`
    && response.request().method() === "POST", { timeout: 30_000 });
  await reviewerPage.getByRole("button", { name: "Propose replacement" }).click();
  expect((await created).status()).toBe(200);
  // Then: the Owner sees it live and again after a full reload.
  await waitForRenderedText(ownerPage, "report");
  await ownerPage.reload({ waitUntil: "domcontentloaded" });
  await Promise.all([
    waitForRenderedText(ownerPage, "report"),
    waitForRenderedText(ownerPage, "pending"),
  ]);
  console.info("P2U_REVIEW_SUGGESTIONS_STAGE", "live-and-reload");
  // When: a real Editor source transaction diverges the exact anchored quote.
  const projects = app.application.runtime.services.get("projects");
  if (!(projects instanceof CoreProjects)) throw new TypeError("Core projects service unavailable");
  const scope = { projectId: ids.project, branch: "main" };
  const source = await projects.loadDocument(scope, ids.mainFile);
  const document = sourceDoc(source.state);
  try {
    const edit = ProposedEditSchema.parse({
      ...proposal(document, {
        fileId: ids.mainFile, before: "article", after: "book", baseRevision: 0,
      }),
      id: crypto.randomUUID(), status: "pending",
    });
    const refreshed = ownerPage.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/projects/${ids.project}/effective-access`
      && response.request().method() === "GET", { timeout: 30_000 });
    await app.application.runtime.admission.writer(
      () => projects.applyEdits(ids.mai, scope, [edit], "ui-review-conflict"),
    );
    expect((await refreshed).status()).toBe(200);
  } finally {
    document.destroy();
  }
  console.info("P2U_REVIEW_SUGGESTIONS_STAGE", "source-diverged");
  // When: the Owner accepts the now-diverged persisted proposal.
  const decided = ownerPage.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/suggestions/decide`
    && response.request().method() === "POST", { timeout: 30_000 });
  await ownerPage.getByRole("button", { name: "Accept", exact: true }).click();
  expect((await decided).status()).toBe(200);
  await waitForRenderedText(ownerPage, "Conflict: source no longer matches");
  console.info("P2U_REVIEW_SUGGESTIONS_STAGE", "conflict-rendered");
  // Then: the conflict survives reload and renders at desktop and mobile widths.
  await openPanel(ownerPage, { view: "review", select: "book" });
  await waitForRenderedText(ownerPage, "Conflict: source no longer matches");
  console.info("P2U_REVIEW_SUGGESTIONS_STAGE", "conflict-reloaded");
  await ownerPage.screenshot({
    path: "tests/ui-editor/review/evidence/review-1440-light.png", fullPage: true,
  });
  await using mobileOwner = await authenticatedContext(browser, app, {
    viewport: { width: 390, height: 844 },
  });
  const mobile = await mobileOwner.context.newPage();
  await openPanel(mobile, { view: "review", theme: "dark", select: "book" });
  await waitForRenderedText(mobile, "Conflict: source no longer matches");
  await mobile.screenshot({
    path: "tests/ui-editor/review/evidence/review-390-dark.png", fullPage: true,
  });
  console.info("P2U_REVIEW_SUGGESTIONS_STAGE", "screenshots-written");
}, 300_000);
