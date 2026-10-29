import { expect, test } from "bun:test";
import { authenticatedContext, waitForRenderedText } from "../shared";
import { createProject } from "../tools/helpers";
import { openSurface } from "../assembly/actual-browser";
import { remoteFixture } from "./fixture";

test.each(["off", "escape"] as const)("canceling a held lookup through %s clears its loading feedback", async action => {
  // Given an actual pending provider response and its visible loading feedback.
  await using setup = await remoteFixture();
  await using actor = await authenticatedContext(setup.browser, setup.app);
  const project = await createProject(actor, { name: "P71 cancellation feedback", origin: setup.app.url.origin });
  const page = await actor.context.newPage();
  page.on("pageerror", error => { setup.errors.push(error.message); console.error("P71_PAGE_ERROR", error.message); });
  try {
    await openSurface(page, { path: `/projects/${project.id}/edit`, selector: ".qe-main .cm-content" });
  } catch (failure) {
    console.error("P71_ROUTE_FAILURE", await page.locator("body").innerText());
    await page.screenshot({ path: `${setup.evidence}/route-failure.png` });
    throw failure;
  }
  await page.locator(".q-source-references summary").click();
  await page.getByLabel("Inline reference provider").selectOption("crossref");
  await page.getByRole("button", { name: "Done configuring references" }).click();
  const held = setup.hold("feedback");
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+Home");
  await page.keyboard.insertText("\\cite{feedback");
  await held.started;
  await waitForRenderedText(page, "Searching remote references");
  const loading = await page.locator(".q-source-notice").innerText();
  const canceled = page.waitForEvent("requestfailed", { predicate: request =>
    new URL(request.url()).searchParams.get("query") === "feedback", timeout: 30_000 });
  // When the user cancels without starting another eligible query.
  switch (action) {
    case "off":
      if (await page.locator(".q-source-references").getAttribute("open") === null) {
        await page.locator(".q-source-references summary").click();
      }
      await page.getByLabel("Inline reference provider").selectOption("");
      break;
    case "escape":
      await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("Escape");
      break;
  }
  await canceled;
  held.release();
  await held.completed;
  // Then the completed cancellation cannot leave the prior loading announcement.
  expect(await page.locator(".q-source-notice").allTextContents()).not.toContain(loading);
}, 120_000);
