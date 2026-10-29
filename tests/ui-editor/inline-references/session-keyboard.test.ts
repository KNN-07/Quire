import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { bibliographyKeys } from "../../../apps/web/src/features/editor/tools/insertion";
import { authenticateApi, authenticatedContext, nextApplicationEvent, projectDocument, waitForRenderedText } from "../shared";
import { createProject, responseAfter } from "../tools/helpers";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";
import { remoteFixture } from "./fixture";

test("keyboard acceptance after the interaction guard retains a receipt only for the initiating session", async () => {
  // Given: an authenticated editor with a deliberate provider choice and a fixed
  // Date.now. Timers remain real; this tests CodeMirror's timestamp guard, not a sleep.
  await using setup = await remoteFixture();
  await using actor = await authenticatedContext(setup.browser, setup.app);
  const project = await createProject(actor, { name: "P71 keyboard and session", origin: setup.app.url.origin });
  const scope = { projectId: project.id, branch: "main", fileId: project.settings.mainFileId };
  const page = await actor.context.newPage();
  await openSurface(page, { path: `/projects/${project.id}/edit`, selector: ".qe-main .cm-content" });
  await page.locator(".q-source-references summary").click();
  await page.getByLabel("Inline reference provider").selectOption("crossref");
  await page.getByRole("button", { name: "Done configuring references" }).click();
  const timestamp = Date.now();
  await page.clock.setFixedTime(timestamp);
  const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
  await source.press("ControlOrMeta+Home");
  const shown = await surfaceSignal(page, ".cm-tooltip-autocomplete [role=option]");
  using saved = nextApplicationEvent(setup.app, event => event.topic === "document.saved" && event.aggregateId === project.id);
  const searched = await responseAfter(page, { path: "/api/references/search", method: "GET" }, () =>
    page.keyboard.insertText("\\cite{keyboard"));
  const publication = editorValue(resultSchema(endpoints.referencesSearch.output).parse(await searched.json())).items[0];
  if (!publication) throw new TypeError("Actual provider result required.");
  const key = bibliographyKeys(publication.bibtex)[0]?.key;
  if (!key) throw new TypeError("Actual citation key required.");
  await shown.observed;
  await saved.promise;
  // When: the clock crosses the installed 75 ms completion interaction guard,
  // Enter accepts the real result, and the account later opens a new session.
  await page.clock.setFixedTime(timestamp + 100);
  const copied = await responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" }, () =>
    source.press("Enter"));
  expect(copied.status()).toBe(200);
  await waitForRenderedText(page, "Inserted citation key in the existing command.");
  expect((await projectDocument(actor.context, scope)).text).toContain(`\\cite{${key}`);
  await openSurface(page, { path: `/projects/${project.id}/edit`, selector: ".qe-main .cm-content" });
  await waitForRenderedText(page, "Inserted citation key in the existing command.");
  const renewed = await authenticateApi(setup.app);
  expect(renewed.session.csrfToken).not.toBe(actor.session.csrfToken);
  await actor.context.addCookies([renewed.cookie]);
  await openSurface(page, { path: `/projects/${project.id}/edit`, selector: ".qe-main .cm-content" });
  await page.locator(".q-source-references summary").click();
  // Enabled controls prove the new session fingerprint was obtained, not merely
  // that an early loading render temporarily lacked the prior receipt.
  await page.getByLabel("Inline reference provider").selectOption("crossref");
  // Then: persisted source remains shared project data, but the old session's
  // receipt is not presented to the new session in the same tab.
  expect(await source.innerText()).toContain(`\\cite{${key}`);
  expect((await page.locator(".q-source-notice").allTextContents()).some(text => text.includes(key))).toBe(false);
  const retained = await page.evaluate(() => Object.keys(sessionStorage).filter(name => name === "quire:inline-reference-receipt").length);
  expect(retained).toBe(1);
  console.info("P71_KEYBOARD_SESSION", { projectId: project.id, key, retained, renewedSessionReceiptHidden: true });
}, 120_000);
