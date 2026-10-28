import { assistantApplication } from "./application";
import { assistantBrowser, capture, consent, evidenceDir } from "./browser";
import { waitForRenderedText } from "../shared/browser";

/** Captures authorized browser SSE completion and durable governed review. */
async function captureGovernedReview() {
  await using app = await assistantApplication();
  await app.configure();
  app.provider.respond(context => ({ text: "The proposed comment is ready for review.", citations: [],
    patches: context.files.map(file => ({ fileId: file.id, path: file.path,
      from: 0, to: 0, before: "", after: "% governed review\n" })) }));
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  const scope = { projectId: app.project.id, branch: app.project.defaultBranch };
  const original = await app.core.readDocument(scope, app.project.settings.mainFileId);
  await browser.page.getByRole("button", { name: "Agent", exact: true }).click();
  await browser.page.getByLabel("Tool", { exact: true }).selectOption("texgpt");
  await browser.page.getByText("Context ·", { exact: false }).click();
  await browser.page.getByRole("group", { name: "Selected files" }).getByLabel("main.tex", { exact: true }).check();
  await browser.page.getByLabel("Message the assistant").fill("Add a comment for explicit review");
  await browser.page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(browser.page, "Agent run · succeeded");
  const generated = await app.core.readDocument(scope, original.file.id);
  if (generated.text !== original.text) throw new TypeError("Generation changed source");
  await capture(browser.page, "review-pending");
  await browser.page.getByRole("button", { name: "Accept all", exact: true }).click();
  await waitForRenderedText(browser.page, "Accepted 1 edits");
  const accepted = await app.core.readDocument(scope, original.file.id);
  if (accepted.text !== `% governed review\n${original.text}`) throw new TypeError("Accepted source missing");
  await capture(browser.page, "review-accepted");
  await browser.page.getByRole("button", { name: "Undo all", exact: true }).click();
  await waitForRenderedText(browser.page, "Undone 1 edits");
  await browser.page.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(browser.page, "rejected");
  const undone = await app.core.readDocument(scope, original.file.id);
  if (undone.text !== original.text) throw new TypeError("Undo did not persist");
  await capture(browser.page, "review-undone");
  await Bun.write(`${evidenceDir}/visual-workflows.json`, JSON.stringify({
    inference: "owned loopback fixture, not a live provider",
    completion: "authorized browser SSE; no manual Refresh or polling",
    generatedSourceUnchanged: generated.text === original.text,
    acceptedPersisted: accepted.text === `% governed review\n${original.text}`,
    undoPersistedAfterReload: undone.text === original.text,
    providerCalls: app.provider.received.length, rawErrors: browser.errors,
  }, null, 2));
  if (browser.errors.length) throw new TypeError(`Raw browser errors: ${JSON.stringify(browser.errors)}`);
}
if (import.meta.main) await captureGovernedReview();
