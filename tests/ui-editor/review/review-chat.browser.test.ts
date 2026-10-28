import { expect, test } from "bun:test";
import { defaultPolicy, fixtureIds as ids } from "../../fixtures/foundation";
import {
  authenticatedContext, projectDocument, startEditorApplication, startEditorBrowser, waitForRenderedText,
} from "../shared";
import { openPanel } from "./browser-harness";

test("runs anchored comments, local proposal decisions, live chat and Viewer denial", async () => {
  // Given: owner, reviewer and Viewer sessions on the same real project.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using owner = await authenticatedContext(browser, app, {
    viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"],
  });
  await using reviewer = await authenticatedContext(browser, app, {
    email: "sam@quire.local", viewport: { width: 1440, height: 900 },
  });
  await using viewer = await authenticatedContext(browser, app, {
    email: "alex@quire.local", viewport: { width: 390, height: 844 },
  });
  const ownerReview = await owner.context.newPage();
  const reviewerReview = await reviewer.context.newPage();
  await Promise.all([
    openPanel(ownerReview, { view: "review", select: "article" }),
    openPanel(reviewerReview, { view: "review", select: "article" }),
  ]);
  console.info("P2U_REVIEW_COLLAB_STAGE", "review-panels-ready");
  // When: the Reviewer creates an anchored comment after both event streams are ready.
  await reviewerReview.getByLabel(/Comment on/).fill("Please use report here.");
  const created = reviewerReview.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/threads`
    && response.request().method() === "POST", { timeout: 30_000 });
  await reviewerReview.getByRole("button", { name: "Comment" }).click();
  expect((await created).status()).toBe(200);
  // Then: the owner sees the comment live and it remains after reload.
  await waitForRenderedText(ownerReview, "Please use report here.");
  await ownerReview.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(ownerReview, "Please use report here.");
  console.info("P2U_REVIEW_COLLAB_STAGE", "comment-live-persisted");
  // When: the comment author edits it and both roles exercise reply and moderation controls.
  await reviewerReview.getByRole("button", { name: "Edit" }).click();
  await reviewerReview.getByLabel("Edit comment").fill("Please use report in this section.");
  const edited = reviewerReview.waitForResponse(response =>
    new URL(response.url()).pathname.includes("/comments/")
    && response.request().method() === "PATCH", { timeout: 30_000 });
  await reviewerReview.getByRole("button", { name: "Save" }).click();
  expect((await edited).status()).toBe(200);
  await ownerReview.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(ownerReview, "Please use report in this section.");
  const replyField = ownerReview.getByLabel("Reply");
  await replyField.fill("I will update it.");
  const replied = ownerReview.waitForResponse(response =>
    new URL(response.url()).pathname.includes("/replies")
    && response.request().method() === "POST", { timeout: 30_000 });
  await replyField.press("Enter");
  expect((await replied).status()).toBe(200);
  await reviewerReview.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(reviewerReview, "I will update it.");
  const deletedComment = reviewerReview.waitForResponse(response =>
    new URL(response.url()).pathname.includes("/comments/")
    && response.request().method() === "DELETE", { timeout: 30_000 });
  await reviewerReview.getByRole("button", { name: "Delete" }).click();
  expect((await deletedComment).status()).toBe(200);
  await ownerReview.reload({ waitUntil: "domcontentloaded" });
  const resolved = ownerReview.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/state")
    && response.request().method() === "POST", { timeout: 30_000 });
  await ownerReview.getByRole("button", { name: "Resolve" }).click();
  expect((await resolved).status()).toBe(200);
  await reviewerReview.reload({ waitUntil: "domcontentloaded" });
  await reviewerReview.getByLabel("Show").selectOption("resolved");
  await waitForRenderedText(reviewerReview, "Resolved thread");
  await ownerReview.getByLabel("Show").selectOption("resolved");
  await waitForRenderedText(ownerReview, "Reopen");
  const reopened = ownerReview.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/state")
    && response.request().method() === "POST", { timeout: 30_000 });
  await ownerReview.getByRole("button", { name: "Reopen" }).click();
  expect((await reopened).status()).toBe(200);
  await ownerReview.getByLabel("Show").selectOption("open");
  await waitForRenderedText(ownerReview, "Resolve");
  const resolvedAgain = ownerReview.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/state")
    && response.request().method() === "POST", { timeout: 30_000 });
  await ownerReview.getByRole("button", { name: "Resolve" }).click();
  expect((await resolvedAgain).status()).toBe(200);
  await ownerReview.getByLabel("Show").selectOption("resolved");
  await waitForRenderedText(ownerReview, "Delete resolved thread");
  const deletedThread = ownerReview.waitForResponse(response =>
    new URL(response.url()).pathname.includes("/threads/")
    && response.request().method() === "DELETE", { timeout: 30_000 });
  await ownerReview.getByRole("button", { name: "Delete resolved thread" }).click();
  expect((await deletedThread).status()).toBe(200);
  // When: selected and all proposal decisions are exercised without Reviewer source mutation.
  const propose = async (replacement: string) => {
    await ownerReview.getByLabel("Replacement text").fill(replacement);
    const response = ownerReview.waitForResponse(entry =>
      new URL(entry.url()).pathname === `/api/projects/${ids.project}/suggestions`
      && entry.request().method() === "POST", { timeout: 30_000 });
    await ownerReview.getByRole("button", { name: "Propose replacement" }).click();
    expect((await response).status()).toBe(200);
  };
  await propose("draft");
  await propose("paper");
  await ownerReview.locator(".quire-suggestion__select input:not(:disabled)").first().click();
  await waitForRenderedText(ownerReview, "1 selected");
  const rejectedSelected = ownerReview.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/suggestions/decide`
    && response.request().method() === "POST", { timeout: 30_000 });
  await ownerReview.getByRole("button", { name: "Reject selected" }).click();
  expect((await rejectedSelected).status()).toBe(200);
  const rejectedAll = ownerReview.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/suggestions/decide`
    && response.request().method() === "POST", { timeout: 30_000 });
  await ownerReview.getByRole("button", { name: "Reject all" }).click();
  expect((await rejectedAll).status()).toBe(200);
  await propose("report");
  await ownerReview.locator(".quire-suggestion__select input:not(:disabled)").first().click();
  await waitForRenderedText(ownerReview, "1 selected");
  const acceptedSelected = ownerReview.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/suggestions/decide`
    && response.request().method() === "POST", { timeout: 30_000 });
  await ownerReview.getByRole("button", { name: "Accept selected" }).click();
  expect((await acceptedSelected).status()).toBe(200);
  expect((await projectDocument(owner.context, {
    projectId: ids.project, branch: "main", fileId: ids.mainFile,
  })).text).toContain("{report}");
  await openPanel(ownerReview, { view: "review", select: "report" });
  await propose("book");
  const acceptedAll = ownerReview.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/suggestions/decide`
    && response.request().method() === "POST", { timeout: 30_000 });
  await ownerReview.getByRole("button", { name: "Accept all" }).click();
  expect((await acceptedAll).status()).toBe(200);
  expect((await projectDocument(owner.context, {
    projectId: ids.project, branch: "main", fileId: ids.mainFile,
  })).text).toContain("{book}");
  console.info("P2U_REVIEW_COLLAB_STAGE", "proposal-accepted");
  // When: a named Viewer attempts the same direct review mutation.
  const denied = await viewer.context.request.post(`/api/projects/${ids.project}/threads`, {
    headers: {
      origin: app.url.origin,
      "x-csrf-token": viewer.session.csrfToken,
      "idempotency-key": crypto.randomUUID(),
    },
    data: {
      scope: { projectId: ids.project, branch: "main" },
      body: "Viewer write", expectedVersion: 2,
    },
    timeout: 30_000,
  });
  // Then: the server, not hidden UI alone, denies the Viewer write.
  expect(denied.status()).toBe(403);
  console.info("P2U_REVIEW_COLLAB_STAGE", "viewer-denied");
  const ownerChat = await owner.context.newPage();
  const viewerChat = await viewer.context.newPage();
  await Promise.all([openPanel(ownerChat, { view: "chat" }), openPanel(viewerChat, { view: "chat" })]);
  await viewerChat.getByLabel("Message").fill("Viewer chat persists");
  const sent = viewerChat.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/chat`
    && response.request().method() === "POST", { timeout: 30_000 });
  await viewerChat.getByRole("button", { name: "Send message" }).click();
  expect((await sent).status()).toBe(200);
  await waitForRenderedText(ownerChat, "Viewer chat persists");
  await ownerChat.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(ownerChat, "Viewer chat persists");
  console.info("P2U_REVIEW_COLLAB_STAGE", "chat-live-persisted");
  // When: current organization policy disables chat.
  await app.application.runtime.db.run("UPDATE organizations SET policy_json=?", [
    JSON.stringify({ ...defaultPolicy, chat: false }),
  ]);
  await viewerChat.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(viewerChat, "Chat is disabled by current project or organization policy.");
  await using mobileOwner = await authenticatedContext(browser, app, {
    viewport: { width: 390, height: 844 },
  });
  const mobileReview = await mobileOwner.context.newPage();
  await openPanel(mobileReview, { view: "review", theme: "dark", select: "book" });
  const darkChat = await owner.context.newPage();
  await darkChat.goto(`/src/features/editor/review/fixture.html?${new URLSearchParams({
    project: ids.project, file: ids.mainFile, view: "chat", theme: "dark",
  })}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForRenderedText(darkChat, "Chat is disabled by current project or organization policy.");
  await ownerReview.screenshot({ path: "tests/ui-editor/review/evidence/review-1440-light.png", fullPage: true });
  await mobileReview.screenshot({ path: "tests/ui-editor/review/evidence/review-390-dark.png", fullPage: true });
  await viewerChat.screenshot({ path: "tests/ui-editor/review/evidence/chat-390-light.png", fullPage: true });
  await darkChat.screenshot({ path: "tests/ui-editor/review/evidence/chat-1440-dark.png", fullPage: true });
  console.info("P2U_REVIEW_COLLAB_STAGE", "screenshots-written");
}, 480_000);
