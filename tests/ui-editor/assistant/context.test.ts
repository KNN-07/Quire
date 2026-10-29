import { expect, test } from "bun:test";
import { AiToolSchema, endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { assistantApplication } from "./application";
import { assistantBrowser, assistantIdle, capture, consent, evidenceDir, sendAndRefresh } from "./browser";
import { waitForRenderedText } from "../shared/browser";

test("sends the explicit UTF-16 range and exposes all governed tool values", async () => {
  // Given an active real document and explicit range consent.
  await using app = await assistantApplication();
  await app.configure();
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  await browser.page.getByText("Context ·", { exact: false }).click();
  await browser.page.getByLabel("Send active UTF-16 range").check();
  const selected = await browser.page.getByLabel("Selected text").textContent();
  if (selected === null) throw new TypeError("Selection preview missing");
  const options = await browser.page.getByLabel("Tool", { exact: true }).locator("option").evaluateAll(nodes => nodes.map(node => node.getAttribute("value")));
  // When a selected-range Ask request crosses the real HTTP boundary.
  await browser.page.getByLabel("Message the assistant").fill("Explain this range only");
  await sendAndRefresh(browser.page, app);
  await waitForRenderedText(browser.page, "Ask run · succeeded");
  // Then only the selected text was sent, and every registered tool is selectable.
  expect(options).toEqual(AiToolSchema.options);
  expect(app.provider.contexts.at(-1)?.files.map(file => ({ from: file.from, to: file.to, text: file.text })))
    .toEqual([{ from: 0, to: 12, text: selected }]);
  expect(browser.errors).toEqual([]);
}, 120_000);

test("cancels a provider-bound run through the typed cancellation endpoint", async () => {
  // Given a provider request held by an event gate, never a timer.
  await using app = await assistantApplication();
  await app.configure();
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  const scope = { projectId: app.project.id, branch: app.project.defaultBranch };
  const original = await app.core.readDocument(scope, app.project.settings.mainFileId);
  const gate = app.provider.gate();
  try {
    await browser.page.getByLabel("Message the assistant").fill("A cancelable request");
    await browser.page.getByRole("button", { name: "Send", exact: true }).click();
    await gate.entered;
    // When the user explicitly cancels the pending run.
    await browser.page.getByRole("button", { name: "Cancel run", exact: true }).click();
    await waitForRenderedText(browser.page, "Ask run · canceled");
    // Then no fabricated answer or source proposal appears.
    expect((await app.core.readDocument(scope, original.file.id)).text).toBe(original.text);
    expect(await browser.page.getByRole("region", { name: "Proposed changes", exact: true }).count()).toBe(0);
    expect(app.provider.received).toHaveLength(1);
    expect(browser.errors).toEqual([]);
  } finally { gate.release(); }
}, 120_000);

test("persists explicitly opted-in shared chat and clears it through the actual endpoint", async () => {
  // Given a user-created shared project conversation.
  await using app = await assistantApplication();
  await app.configure();
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  await browser.page.getByRole("combobox", { name: "Future conversation choice", exact: true }).selectOption("shared");
  const created = browser.page.waitForResponse(response => response.request().method() === "POST"
    && response.url().endsWith(`/projects/${app.project.id}/ai/conversations`));
  await browser.page.getByRole("button", { name: "Create shared conversation", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(200);
  const conversation = editorValue(resultSchema(endpoints.aiConversationCreate.output).parse(await response.json()));
  await waitForRenderedText(browser.page, conversation.id);
  await browser.page.getByLabel("Message the assistant").fill("Remember in shared chat");
  await sendAndRefresh(browser.page, app);
  await waitForRenderedText(browser.page, "Ask run · succeeded");
  // When the user explicitly clears the shared chat.
  await browser.page.getByRole("button", { name: "Clear shared chat", exact: true }).click();
  await waitForRenderedText(browser.page, "Shared chat cleared");
  // Then retained chat text is absent from the displayed conversation.
  expect(await browser.page.getByRole("region", { name: "Assistant messages", exact: true }).textContent())
    .not.toContain("Remember in shared chat");
  expect(browser.errors).toEqual([]);
}, 120_000);

test("shows viewer restrictions from actual effective access", async () => {
  // Given a named viewer with real authentication and project membership.
  await using app = await assistantApplication();
  const viewer = await app.login("outsider@quire.local");
  await app.runtime.db.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'viewer',?)",
    [crypto.randomUUID(), app.project.id, viewer.user.id, app.runtime.clock.now()]);
  await using browser = await assistantBrowser(app);
  await browser.context.addCookies([viewer.cookie]);
  // When the viewer opens the actual assistant surface.
  await browser.open();
  // Then Agent acceptance is unavailable with a visible reason.
  expect(await browser.page.getByRole("button", { name: "Agent", exact: true }).isDisabled()).toBe(true);
  expect(await browser.page.getByRole("status").allTextContents()).toContain("Viewer or review-only access. Agent edits cannot be accepted.");
  await capture(browser.page, "viewer");
  expect(browser.errors).toEqual([]);
}, 120_000);

test("publishes terminal AI state through authorized browser SSE without polling", async () => {
  // Given a real in-flight run whose provider completion is gated by an event.
  await using app = await assistantApplication();
  await app.configure();
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  const frames: string[] = [];
  browser.page.on("console", message => {
    if (message.text().startsWith("ASSISTANT_EVENT_FRAME ")) frames.push(message.text().slice(22));
  });
  await browser.page.evaluate(() => {
    const controller = new AbortController();
    window.addEventListener("pagehide", () => controller.abort(), { once: true });
    void fetch("/api/events?after=0", { signal: controller.signal }).then(async response => {
      if (!response.body) throw new TypeError("Missing SSE evidence stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) return;
          console.info(`ASSISTANT_EVENT_FRAME ${decoder.decode(part.value, { stream: true })}`);
        }
      } finally { reader.releaseLock(); }
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof Error) console.error(`SSE evidence: ${error.message}`);
      else throw error;
    });
  });
  const gate = app.provider.gate();
  try {
    await browser.page.getByLabel("Message the assistant").fill("Report completion through notifications");
    await browser.page.getByRole("button", { name: "Send", exact: true }).click();
    await gate.entered;
    await browser.page.getByRole("button", { name: "Cancel run", exact: true }).waitFor({ state: "visible" });
    await assistantIdle(browser.page);
    // When the actual provider is released, without pressing Refresh.
    gate.release();
    await waitForRenderedText(browser.page, "Ask run · succeeded");
    // Then the terminal DTO reaches the UI from its real notification subscription.
    expect(app.provider.received).toHaveLength(1);
    expect(browser.errors).toEqual([]);
  } finally {
    gate.release();
    await Bun.write(`${evidenceDir}/sse-observation.json`, JSON.stringify({
      frames, rawErrors: browser.errors, text: await browser.page.locator("body").innerText(),
    }, null, 2));
  }
}, 120_000);
