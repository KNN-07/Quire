import { expect, test } from "bun:test";
import * as Y from "yjs";
import { CoreProjects } from "../../../services/core/base";
import { fixtureIds } from "../../fixtures/foundation";
import { projectDocument } from "../shared";
import { openSurface, surfaceSignal } from "./actual-browser";
import { assemblyAssistant } from "./assistant-fixture";

test("retains genuine unacknowledged source through an epoch replacement and explicit recovery", async () => {
  // Given actual authoring and a real branch lease held before the local edit.
  await using setup = await assemblyAssistant();
  const { app, owner, context, page } = setup;
  const scope = { projectId: fixtureIds.project, branch: "main" };
  const sourceScope = { ...scope, fileId: fixtureIds.mainFile };
  await openSurface(page, { path: `/projects/${fixtureIds.project}/edit`, selector: '.qe-main .cm-content[contenteditable="true"]' });
  const projects = app.application.runtime.services.get("projects");
  if (!(projects instanceof CoreProjects)) throw new TypeError("Actual core projects required");
  const before = await projectDocument(context, sourceScope);
  const marker = `\n% genuinely unacknowledged Unicode 😀 ${crypto.randomUUID()}\n`;
  const localText = before.text + marker;
  const serverText = "\\documentclass{article}\n\\begin{document}\nNEW SERVER EPOCH\n\\end{document}\n";
  const replacement = new Y.Doc();
  replacement.getText("source").insert(0, serverText);
  const recovered = await surfaceSignal(page, '.qe-status [data-save-state="recovery"]');
  try {
    await projects.serialized(scope, async lease => {
      const files = await projects.listFiles(scope);
      const revision = (await projects.getBranch(scope)).revision;
      const saving = await surfaceSignal(page, '.qe-status [data-save-state="saving"]');
      await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+End");
      await page.keyboard.insertText(marker);
      await saving.observed;
      // The native update is queued behind this lease; no timer, mocked socket or lost-ack shim.
      expect((await projects.loadDocument(scope, fixtureIds.mainFile)).text).toBe(before.text);
      await projects.commitSource({ lease, actorId: owner.user.id, scope, expectedRevision: revision,
        inputs: files.map(file => file.id === fixtureIds.mainFile
          ? { file: { ...file, version: { ...file.version, epoch: file.version.epoch + 1 } }, document: replacement } : { file }),
      });
    });
    await recovered.observed;
  } finally { replacement.destroy(); }
  // When the real old-epoch update is rejected, Assistant exposes the exact retained local text.
  expect(await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).getAttribute("contenteditable")).toBe("false");
  await page.locator(".qa-assistant__recovery summary").click();
  expect(await page.locator(".qa-assistant__recovery pre").textContent()).toBe(localText);
  expect((await projectDocument(context, sourceScope)).text).toBe(serverText);
  await page.screenshot({ path: `${setup.evidence}/genuine-pending-recovery.png` });
  const reopened = await surfaceSignal(page, '.qe-main .cm-content[contenteditable="true"]');
  await page.locator(".qa-assistant__header").getByRole("button", { name: "Refresh", exact: true }).click();
  await reopened.observed;
  // Then the new authoritative document opens without losing or rebasing the old pending source.
  const retained = page.getByRole("textbox", { name: "Retained source: main.tex", exact: true });
  await page.locator(".qe-message summary").click();
  expect(await retained.inputValue()).toBe(localText);
  const discard = await surfaceSignal(page, "dialog[open]");
  await page.getByRole("button", { name: "Discard recovery copy…", exact: true }).click();
  await discard.observed;
  await page.getByRole("dialog", { name: "Discard recovery copy?", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await retained.inputValue()).toBe(localText);
  expect((await projectDocument(context, sourceScope)).text).toBe(serverText);
  expect(setup.errors).toEqual([]);
  await page.screenshot({ path: `${setup.evidence}/retained-source-after-reopen.png` });
}, 120_000);
