import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { AccessRequestSchema, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { authenticatedContext, startEditorApplication, startEditorBrowser } from "../shared";
import { openPanel } from "./browser-harness";

test("Share exposes only valid upgrades and shows the owner's real pending count", async () => {
  // Given real Viewer, Reviewer, Editor and Owner accounts and a pending request.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  const evidence = `docs/evidence/p12-access-requests/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  console.info("ACCESS_UI_OWNED", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin, evidence });
  await using viewer = await authenticatedContext(browser, app, { email: "alex@quire.local" });
  expect((await viewer.context.request.post(`/api/projects/${ids.project}/access-requests`, {
    headers: { origin: app.url.origin, "x-csrf-token": viewer.session.csrfToken, "idempotency-key": crypto.randomUUID() },
    data: { role: "reviewer", message: "Please review my access", expectedVersion: 0 },
  })).status()).toBe(200);
  const observations: { role: string; width: number; options: string[]; submit: number; pending: string | null }[] = [];
  // When each role opens the actual Share component backed by the native service.
  for (const [role, email] of [["reviewer", "sam@quire.local"], ["editor", "mai@quire.local"], ["owner", "kien@quire.local"]] as const) {
    for (const width of [1440, 390]) {
      await using actor = await authenticatedContext(browser, app, {
        email, viewport: { width, height: width === 390 ? 844 : 900 },
        isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
      });
      const page = await actor.context.newPage();
      for (const theme of ["light", "dark"] as const) {
        await openPanel(page, { view: "share", theme, live: role === "owner" });
        const pending = page.getByLabel("Pending access requests", { exact: true });
        observations.push({
          role, width,
          options: await page.getByRole("combobox", { name: /^Requested role/ }).locator("option").evaluateAll(nodes => nodes.map(node => node.getAttribute("value") ?? "")),
          submit: await page.getByRole("button", { name: "Send request", exact: true }).count(),
          pending: await pending.count() ? await pending.textContent() : null,
        });
        await page.screenshot({ path: `${evidence}/${role}-${width}-${theme}.png`, fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
  await Bun.write(`${evidence}/observations.json`, JSON.stringify(observations, null, 2));
  // Then the UI offers the same role transitions enforced by the server.
  for (const item of observations) {
    if (item.role === "reviewer") expect(item.options).toEqual(["editor"]);
    if (item.role === "editor") expect(item.submit).toBe(0);
    if (item.role === "owner") expect(item.pending).toBe("1");
  }
  await using reviewer = await authenticatedContext(browser, app, { email: "sam@quire.local" });
  const requestPage = await reviewer.context.newPage();
  await openPanel(requestPage, { view: "share", live: false });
  await requestPage.getByLabel("Message", { exact: true }).fill("I need to edit the draft.");
  const submitted = requestPage.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname === `/api/projects/${ids.project}/access-requests`);
  const [response] = await Promise.all([
    submitted, requestPage.getByRole("button", { name: "Send request", exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  const result = editorValue(resultSchema(AccessRequestSchema).parse(await response.json()));
  expect(result.role).toBe("editor");
}, 240_000);
