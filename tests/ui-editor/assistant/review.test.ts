import { expect, test } from "bun:test";
import { assistantApplication } from "./application";
import { assistantBrowser, capture, consent, generate } from "./browser";
import { waitForRenderedText } from "../shared/browser";

test("rejects generated proposals without modifying durable source", async () => {
  // Given a real governed provider invocation and a real document transport.
  await using app = await assistantApplication();
  await app.configure();
  app.provider.respond(context => ({ text: "Changes await your review.", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% reviewed\n",
  })) }));
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  const scope = { projectId: app.project.id, branch: app.project.defaultBranch };
  const original = await app.core.readDocument(scope, app.project.settings.mainFileId);
  await generate(browser.page, app);
  expect((await app.core.readDocument(scope, original.file.id)).text).toBe(original.text);
  await capture(browser.page, "pending");
  // When the user rejects all proposals.
  await browser.page.getByRole("button", { name: "Reject all", exact: true }).click();
  await waitForRenderedText(browser.page, "Rejected 1 edits");
  // Then generation and rejection have left durable source unchanged.
  expect((await app.core.readDocument(scope, original.file.id)).text).toBe(original.text);
  expect(app.provider.contexts.at(-1)?.files.map(file => file.id)).toEqual([original.file.id]);
  expect(browser.errors).toEqual([]);
}, 120_000);

test("accepts a reviewed edit durably across reload", async () => {
  // Given a pending proposal.
  await using app = await assistantApplication();
  await app.configure();
  app.provider.respond(context => ({ text: "Comment proposed.", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% accepted\n",
  })) }));
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page); await generate(browser.page, app);
  const scope = { projectId: app.project.id, branch: app.project.defaultBranch };
  const original = await app.core.readDocument(scope, app.project.settings.mainFileId);
  // When a real governed acceptance completes and the browser reloads.
  await browser.page.getByRole("button", { name: "Accept", exact: true }).click();
  await waitForRenderedText(browser.page, "Accepted 1 edits");
  await browser.page.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(browser.page, "accepted");
  // Then the accepted text is retained by the server and fresh transport.
  expect((await app.core.readDocument(scope, original.file.id)).text).toBe(`% accepted\n${original.text}`);
  expect(await browser.page.getByLabel("Source", { exact: true }).inputValue()).toBe(`% accepted\n${original.text}`);
  expect(browser.errors).toEqual([]);
}, 120_000);

test("undoes accepted source durably across reload without another inference charge", async () => {
  // Given an accepted edit through real HTTP and Git source publication.
  await using app = await assistantApplication();
  await app.configure();
  app.provider.respond(context => ({ text: "Undoable comment.", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% undo me\n",
  })) }));
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  const scope = { projectId: app.project.id, branch: app.project.defaultBranch };
  const original = await app.core.readDocument(scope, app.project.settings.mainFileId);
  await generate(browser.page, app);
  await browser.page.getByRole("button", { name: "Accept all", exact: true }).click();
  await waitForRenderedText(browser.page, "Accepted 1 edits");
  // When the user undoes the accepted edit and reloads.
  await browser.page.getByRole("button", { name: "Undo all", exact: true }).click();
  await waitForRenderedText(browser.page, "Undone 1 edits");
  await browser.page.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(browser.page, "rejected");
  // Then the inverse persisted and only generation consumed a use.
  expect((await app.core.readDocument(scope, original.file.id)).text).toBe(original.text);
  expect(await browser.page.getByLabel("Source", { exact: true }).inputValue()).toBe(original.text);
  expect(app.provider.received).toHaveLength(1);
  expect(browser.errors).toEqual([]);
}, 120_000);
