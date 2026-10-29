import { expect, test } from "bun:test";
import type { Page } from "@playwright/test";
import { authenticatedContext, nextApplicationEvent, projectDocument, waitForRenderedText } from "../shared";
import { createInputFile, createProject, responseAfter } from "../tools/helpers";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";
import { remoteFixture } from "./fixture";
import type { RemoteFixture } from "./fixture";

async function configure(page: Page, provider: string) {
  const details = page.locator(".q-source-references");
  if (await details.getAttribute("open") === null) await details.locator("summary").click();
  await page.getByLabel("Inline reference provider").selectOption(provider);
  await page.getByRole("button", { name: "Done configuring references" }).click();
}

async function query(page: Page, setup: RemoteFixture, projectId: string, text: string, prefix = "") {
  using saved = nextApplicationEvent(setup.app, event => event.topic === "document.saved" && event.aggregateId === projectId);
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+A");
  const response = await responseAfter(page, { path: "/api/references/search", method: "GET" }, () =>
    page.keyboard.insertText(`${prefix}\\cite{${text}`));
  await saved.promise;
  return response;
}

async function capture(page: Page, setup: RemoteFixture, name: string) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
    };
    const selectors = [".cm-scroller", ".q-source-references .q-source-stack",
      ".q-reference-tooltip > ul", ".q-source-tracking", ".q-source-tools", ".q-source-proposals"];
    const source = document.querySelector(".q-source-panel");
    const scrollers = selectors.flatMap(selector => [...(source?.querySelectorAll(selector) ?? [])].map(element => ({
      selector, bounded: element.clientHeight > 0, height: element.clientHeight, contentHeight: element.scrollHeight,
      visible: element.getClientRects().length > 0 && (element.closest("details")?.open ?? true),
      overflowY: getComputedStyle(element).overflowY, overflowing: element.scrollHeight > element.clientHeight,
      scrollTop: element.scrollTop,
    })));
    const active = document.activeElement;
    const control = document.querySelector(".q-source-references select");
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, touch: navigator.maxTouchPoints },
      documentWidth: document.documentElement.scrollWidth,
      source: rect(".q-source-editor"), scroller: rect(".q-source-editor .cm-scroller"),
      sheet: rect(".q-reference-tooltip"), caret: rect(".q-source-editor .cm-cursor"),
      selectedKey: rect(".q-reference-tooltip [aria-selected=true] .cm-completionLabel"),
      sheetHeading: rect(".q-reference-heading"), scrollers,
      focus: active ? { tag: active.tagName, label: active.getAttribute("aria-label"), text: active.textContent?.slice(0, 100),
        outlineWidth: getComputedStyle(active).outlineWidth, outlineStyle: getComputedStyle(active).outlineStyle } : null,
      control: control ? { border: getComputedStyle(control).borderColor, background: getComputedStyle(control).backgroundColor,
        height: control.getBoundingClientRect().height, fontSize: getComputedStyle(control).fontSize } : null,
    };
  });
  await page.screenshot({ path: `${setup.evidence}/${name}.png`, scale: "css" });
  await Bun.write(`${setup.evidence}/${name}.json`, JSON.stringify(geometry, null, 2));
  await Bun.write(`${setup.evidence}/${name}.aria.yml`, await page.locator(".q-source-panel").ariaSnapshot());
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport.width);
  if (name.endsWith("-long-results") || name.endsWith("-keyboard-next-result")) {
    expect(geometry.selectedKey?.top ?? -1).toBeGreaterThanOrEqual(geometry.sheetHeading?.bottom ?? Infinity);
  }
  if (geometry.sheet && geometry.scroller && geometry.viewport.width === 390) {
    expect(geometry.sheet.top).toBeGreaterThanOrEqual(geometry.scroller.bottom - 1);
    expect(geometry.sheet.bottom).toBeLessThanOrEqual(geometry.source?.bottom ?? 0);
    if (name.endsWith("-long-results") || name.endsWith("-keyboard-next-result")) {
      expect(geometry.caret).not.toBeNull();
      expect(geometry.caret?.top ?? -1).toBeGreaterThanOrEqual(geometry.scroller.top);
      expect(geometry.caret?.bottom ?? Infinity).toBeLessThanOrEqual(geometry.scroller.bottom);
    }
  }
}

test("reference controls and result sheets expose real states and bounded scroll owners across sizes and themes", async () => {
  await using setup = await remoteFixture();
  const captures: string[] = [];
  for (const width of [390, 1440, 1920]) {
    await using actor = await authenticatedContext(setup.browser, setup.app, {
      viewport: { width, height: width === 390 ? 844 : 900 },
      isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
    });
    const project = await createProject(actor, { name: `P71 states ${width}`, origin: setup.app.url.origin });
    const target = await createInputFile(actor, { projectId: project.id, origin: setup.app.url.origin,
      path: "references-with-a-long-readable-bibliography-destination-name.bib", text: "" });
    const page = await actor.context.newPage();
    page.on("pageerror", error => setup.errors.push(error.message));
    await openSurface(page, { path: `/projects/${project.id}/edit`, selector: ".qe-main .cm-content" });
    await page.getByRole("button", { name: "Source", exact: true }).first().click();
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      const take = async (state: string) => {
        const name = `${width}-${theme}-${state}`;
        await capture(page, setup, name);
        captures.push(name);
      };
      // Given real configuration controls, including the actual long destination.
      await configure(page, "");
      await page.locator(".q-source-references summary").click();
      await take("off-expanded");
      await page.locator(".q-source-references summary").focus();
      await page.keyboard.press("Tab");
      await take("keyboard-focus");
      await page.getByRole("button", { name: "Done configuring references" }).hover();
      await take("pointer-hover");
      await page.mouse.down();
      await take("pointer-pressed");
      await page.mouse.up();
      await configure(page, "crossref");
      // When the real vendor holds the pending request, capture and cancel it.
      const held = setup.hold(`loading-${width}-${theme}`);
      await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+A");
      await page.keyboard.insertText(`\\cite{loading-${width}-${theme}`);
      await held.started;
      await waitForRenderedText(page, "Searching remote references");
      await take("loading");
      const canceled = page.waitForEvent("requestfailed", { predicate: request =>
        new URL(request.url()).searchParams.get("query") === `loading-${width}-${theme}`, timeout: 30_000 });
      await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("Escape");
      await canceled;
      held.release();
      await held.completed;
      await take("canceled");
      expect((await query(page, setup, project.id, "no-results")).status()).toBe(200);
      await waitForRenderedText(page, "Refine the citation query");
      await take("empty");
      await configure(page, "semanticScholar");
      expect((await query(page, setup, project.id, "unavailable")).status()).toBe(503);
      await waitForRenderedText(page, "Choose another provider or ask an administrator");
      await take("error");
      await configure(page, "crossref");
      const timestamp = Date.now();
      await page.clock.setFixedTime(timestamp);
      const shown = await surfaceSignal(page, ".q-reference-tooltip [role=option]");
      const longSource = "% Retained source context\n".repeat(80);
      expect((await query(page, setup, project.id, "long-results", longSource)).status()).toBe(200);
      await shown.observed;
      await take("long-results");
      const nextId = await page.locator(".q-reference-tooltip [role=option]").nth(1).getAttribute("id");
      if (!nextId) throw new TypeError("A second real result is required for keyboard navigation.");
      const selected = await surfaceSignal(page, `.q-reference-tooltip [id="${nextId}"][aria-selected=true]`);
      await page.clock.setFixedTime(timestamp + 100);
      await page.keyboard.press("ArrowDown");
      await selected.observed;
      await take("keyboard-next-result");
      await page.locator(".q-reference-tooltip > ul").evaluate(element => { element.scrollTop = element.scrollHeight; });
      await take("results-end");
      await page.getByRole("button", { name: "Close reference suggestions" }).click();
      // Then explicit dismissal does not copy or insert a result.
      expect(await page.locator(".q-reference-tooltip").count()).toBe(0);
      expect((await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: target.id })).text).toBe("");
      expect((await projectDocument(actor.context, { projectId: project.id, branch: "main",
        fileId: project.settings.mainFileId })).text).toBe(`${longSource}\\cite{long-results`);
      await take("dismissed");
      await page.getByRole("button", { name: "Track changes off", exact: true }).click();
      await page.locator(".q-source-references summary").click();
      expect(await page.getByLabel("Inline reference provider").isDisabled()).toBe(false);
      await page.getByLabel("Inline reference provider").selectOption("");
      expect(await page.getByLabel("Inline reference provider").isDisabled()).toBe(true);
      await take("tracking-off-withdrawn");
      await page.getByRole("button", { name: "Done configuring references" }).click();
      await page.getByRole("button", { name: "Track changes on", exact: true }).click();
    }
  }
  await Bun.write(`${setup.evidence}/presentation.json`, JSON.stringify({ captures, requests: setup.requests,
    emulation: "Chromium viewport/touch/DPR emulation; not physical mobile or human screen-reader proof" }, null, 2));
  expect(setup.errors).toEqual([]);
}, 300_000);
