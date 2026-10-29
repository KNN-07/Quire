import { expect, test } from "bun:test";
import { assistantApplication } from "./application";
import { assistantBrowser, capture, consent, generate, sendAndRefresh } from "./browser";
import { waitForRenderedText } from "../shared/browser";

test("blocks context transmission after an owner marks a project confidential", async () => {
  // Given a configured, consented project.
  await using app = await assistantApplication();
  await app.configure();
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  await browser.page.getByText("AI preferences and consent", { exact: true }).click();
  await browser.page.getByLabel("Confidential project · owner controlled").check();
  // When the owner saves the actual security label and attempts generation.
  await browser.page.getByRole("button", { name: "Save security label", exact: true }).click();
  await waitForRenderedText(browser.page, "Project security label saved");
  await browser.page.getByLabel("Message the assistant").fill("A confidential request");
  await browser.page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(browser.page, "AI_CONFIDENTIAL");
  // Then no context reached the provider.
  expect(app.provider.received).toHaveLength(0);
  expect(browser.errors.filter(error => error.startsWith("pageerror:"))).toEqual([]);
}, 120_000);

test("uploads a consented image through real HTTP and executes the selected image tool", async () => {
  // Given an explicitly enabled vision fixture and user image consent.
  await using app = await assistantApplication();
  await app.configure();
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  await browser.page.getByLabel("Tool", { exact: true }).selectOption("table-image");
  await browser.page.getByText("Context ·", { exact: false }).click();
  await browser.page.getByLabel("Send attached images to the configured provider").check();
  await browser.page.getByLabel("Attach PNG or JPEG").setInputFiles({
    name: "fixture.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==", "base64"),
  });
  await waitForRenderedText(browser.page, "1 images attached");
  // When the user explicitly sends the image request.
  await browser.page.getByLabel("Message the assistant").fill("Transcribe this image as a table");
  await sendAndRefresh(browser.page, app);
  await waitForRenderedText(browser.page, "Ask run · succeeded");
  // Then the actual model HTTP envelope contains an image part and the selected tool.
  expect(app.provider.contexts.at(-1)?.tool).toBe("table-image");
  expect(app.provider.received.at(-1)?.messages.at(-1)?.content).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "image_url" }),
  ]));
  expect(browser.errors).toEqual([]);
}, 120_000);

test("retains current source when reviewed anchors conflict with intervening edits", async () => {
  // Given a pending replacement proposal.
  await using app = await assistantApplication();
  await app.configure();
  app.provider.respond(context => ({ text: "Replacement proposed.", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 12, before: file.text.slice(0, 12), after: "% replacement",
  })) }));
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page); await generate(browser.page, app);
  const source = browser.page.getByLabel("Source", { exact: true });
  const original = await source.inputValue();
  await source.fill(`% intervening\n${original}`);
  // When the user accepts a proposal based on replaced anchors.
  await browser.page.getByRole("button", { name: "Accept all", exact: true }).click();
  await waitForRenderedText(browser.page, "Conflict: source was not changed");
  // Then the intervening durable text survives.
  const document = await app.core.readDocument({ projectId: app.project.id, branch: app.project.defaultBranch }, app.project.settings.mainFileId);
  expect(document.text).toBe(`% intervening\n${original}`);
  await capture(browser.page, "conflict");
  expect(browser.errors).toEqual([]);
}, 120_000);

test("creates an actual AI branch and commit only on acceptance", async () => {
  // Given a clean baseline and a pending reviewed change.
  await using app = await assistantApplication();
  await app.configure();
  app.provider.respond(context => ({ text: "Branch edit proposed.", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% branch-reviewed\n",
  })) }));
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page); await generate(browser.page, app);
  const scope = { projectId: app.project.id, branch: app.project.defaultBranch };
  const original = await app.core.readDocument(scope, app.project.settings.mainFileId);
  await browser.page.getByLabel("Commit accepted changes", { exact: true }).check();
  await browser.page.getByLabel("New branch (optional, ai/ prefix)").fill("ai/browser-review");
  // When the user accepts with real Git options selected.
  const decision = browser.page.waitForResponse(response => response.url().endsWith("/decide")
    && response.request().method() === "POST", { timeout: 30_000 });
  await browser.page.getByRole("button", { name: "Accept all", exact: true }).click();
  expect((await decision).status()).toBe(200);
  // Then the real Git ref holds the accepted content while main is unchanged.
  expect((await app.core.readDocument(scope, original.file.id)).text).toBe(original.text);
  const content = await app.runtime.repositories.read(app.project.id, ["show", "refs/heads/ai/browser-review:main.tex"]);
  expect(new TextDecoder().decode(content)).toBe(`% branch-reviewed\n${original.text}`);
  expect(browser.errors).toEqual([]);
}, 120_000);
