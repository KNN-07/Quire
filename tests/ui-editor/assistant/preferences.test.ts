import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { assistantApplication } from "./application";
import { aiCompletion, assistantBrowser, consent, generate, sendAndRefresh } from "./browser";
import { waitForRenderedText } from "../shared/browser";

test("shows the actual missing configuration denial after explicit consent", async () => {
  // Given valid consent but no operator provider configuration.
  await using app = await assistantApplication();
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  // When a real generation is requested.
  await browser.page.getByLabel("Message the assistant").fill("Explain the document");
  await browser.page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(browser.page, "AI_UNCONFIGURED");
  // Then no inference was dispatched and the exact backend reason is visible.
  expect(await browser.page.getByRole("alert").textContent()).toContain("AI_UNCONFIGURED");
  expect(app.provider.received).toHaveLength(0);
  expect(browser.errors.filter(error => error.startsWith("pageerror:"))).toEqual([]);
}, 120_000);

test("persists model preferences and reports an unconfigured model without inventing availability", async () => {
  // Given a configured default model and a consented user.
  await using app = await assistantApplication();
  await app.configure();
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  await browser.page.getByText("AI preferences and consent", { exact: true }).click();
  await browser.page.getByLabel("Model (empty uses configured default)").fill("unconfigured-fixture-model");
  // When the user persists a different model and sends a prompt.
  await browser.page.getByRole("button", { name: "Save AI preferences", exact: true }).click();
  await waitForRenderedText(browser.page, "AI preferences saved");
  await browser.page.getByLabel("Message the assistant").fill("Explain the document");
  await browser.page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(browser.page, "AI_MODEL_UNCONFIGURED");
  // Then the real preference persisted, while the unconfigured invocation was denied.
  const response = await app.owner.http.get("api/me/preferences");
  const stored: unknown = await response.json();
  expect(stored).toMatchObject({ data: { aiModel: "unconfigured-fixture-model" } });
  expect(app.provider.received).toHaveLength(0);
  expect(browser.errors.filter(error => error.startsWith("pageerror:"))).toEqual([]);
}, 120_000);

test("regenerates through a new governed invocation and consumes another actual use", async () => {
  // Given a completed Ask invocation.
  await using app = await assistantApplication();
  await app.configure();
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  await browser.page.getByLabel("Message the assistant").fill("Explain the document");
  await sendAndRefresh(browser.page, app);
  await waitForRenderedText(browser.page, "Ask run · succeeded");
  // When the user explicitly regenerates.
  const completed = browser.page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/ai/runs"), { timeout: 30_000 });
  using finished = aiCompletion(app);
  await browser.page.getByRole("button", { name: "Regenerate (new use)", exact: true }).click();
  const response = await completed;
  expect(response.status()).toBe(202);
  const next = editorValue(resultSchema(endpoints.aiRunCreate.output).parse(await response.json()));
  await finished.done;
  await browser.page.getByRole("button", { name: "Refresh", exact: true }).click();
  await waitForRenderedText(browser.page, next.id);
  await waitForRenderedText(browser.page, "Ask run · succeeded");
  await waitForRenderedText(browser.page, "usage · 2 used");
  // Then both requests crossed the provider boundary and actual usage increased.
  expect(app.provider.received).toHaveLength(2);
  expect(await browser.page.getByText(/usage · 2 used/u).count()).toBe(1);
  expect(browser.errors).toEqual([]);
}, 120_000);

test("clears private session memory through the actual session endpoint", async () => {
  // Given private Ask memory in the real session.
  await using app = await assistantApplication();
  await app.configure();
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  await browser.page.getByLabel("Message the assistant").fill("Private session context");
  await sendAndRefresh(browser.page, app);
  await waitForRenderedText(browser.page, "Ask run · succeeded");
  // When the user explicitly clears the private session.
  await browser.page.getByRole("button", { name: "Clear private session", exact: true }).click();
  await waitForRenderedText(browser.page, "Private session chat cleared");
  // Then private messages no longer render.
  expect(await browser.page.getByRole("region", { name: "Assistant messages", exact: true }).textContent())
    .not.toContain("Private session context");
  expect(browser.errors).toEqual([]);
}, 120_000);

test.each(["private", "shared"] as const)("accepts retained Agent review after %s chat is cleared", async privacy => {
  // Given a real pending Agent proposal and an explicitly cleared conversation.
  await using app = await assistantApplication();
  await app.configure();
  app.provider.respond(context => ({ text: "Review this edit.", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% retained review\n",
  })) }));
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  const scope = { projectId: app.project.id, branch: app.project.defaultBranch };
  const original = await app.core.readDocument(scope, app.project.settings.mainFileId);
  if (privacy === "shared") {
    await browser.page.getByRole("combobox", { name: "Future conversation choice", exact: true }).selectOption("shared");
    const created = browser.page.waitForResponse(response => response.request().method() === "POST"
      && response.url().endsWith(`/projects/${app.project.id}/ai/conversations`));
    await browser.page.getByRole("button", { name: "Create shared conversation", exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(200);
    const conversation = editorValue(resultSchema(endpoints.aiConversationCreate.output).parse(await response.json()));
    await waitForRenderedText(browser.page, conversation.id);
  }
  await generate(browser.page, app);
  await browser.page.getByRole("button", { name: privacy === "shared" ? "Clear shared chat" : "Clear private session", exact: true }).click();
  await waitForRenderedText(browser.page, privacy === "shared" ? "Shared chat cleared" : "Private session chat cleared");
  // When the user accepts that separately retained Agent review.
  await browser.page.getByRole("button", { name: "Accept all", exact: true }).click();
  await waitForRenderedText(browser.page, "Accepted 1 edits");
  // Then the governed source edit persists despite chat clear.
  expect((await app.core.readDocument(scope, original.file.id)).text).toBe(`% retained review\n${original.text}`);
  expect(browser.errors).toEqual([]);
}, 120_000);
