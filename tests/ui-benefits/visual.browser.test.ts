import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { endpoints, resultSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../fixtures/foundation";
import { authenticatedContext, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../ui-editor/shared";
import { openPanel, waitForAttribute } from "../ui-editor/review/browser-harness";

test("captures benefit controls at all required widths and themes with real native authority", async () => {
  // Given: native SQLite/Git/auth and a fresh server-issued operator session.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  const evidence = process.env["QUIRE_BENEFITS_EVIDENCE_DIR"] ?? "docs/evidence/p4-benefits-controls";
  await mkdir(evidence, { recursive: true });
  console.info("P4_VISUAL_OWNED", { root: app.dataDir, web: app.url.origin, evidence });
  let grantVersion = 0;
  for (const width of [390, 1440, 1920]) {
    for (const theme of ["light", "dark"] as const) {
      const options = { viewport: { width, height: 900 }, colorScheme: theme,
        isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1 };
      await using owner = await authenticatedContext(browser, app, options);
      await using operator = await authenticatedContext(browser, app, { ...options, email: "operator@quire.local" });
      const share = await owner.context.newPage();
      await openPanel(share, { view: "share", theme });
      await share.screenshot({ path: `${evidence}/share-${width}-${theme}-after.png` });
      const mounted = await owner.context.newPage();
      await mounted.goto(`/projects/${ids.project}/edit`, { waitUntil: "domcontentloaded" });
      await waitForAttribute(mounted, { selector: "[data-save-state]", name: "data-save-state", value: "saved" });
      await waitForRenderedText(mounted, "Share");
      await mounted.getByRole("button", { name: "Share", exact: true }).click();
      await waitForRenderedText(mounted, "Selection mode");
      await mounted.screenshot({ path: `${evidence}/mounted-share-${width}-${theme}-after.png` });
      const admin = await operator.context.newPage();
      await admin.goto("/admin", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(admin, "Server overview");
      await admin.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
      await admin.screenshot({ path: `${evidence}/admin-${width}-${theme}-after.png` });
      // When: the real navigation opens the operator grant editor.
      if (width === 390) await admin.getByLabel("Administration section").selectOption("benefits");
      else await admin.getByRole("link", { name: "Project benefits", exact: true }).click();
      await waitForRenderedText(admin, "Grant configured");
      await admin.screenshot({ path: `${evidence}/grants-${width}-${theme}-after.png` });
      for (const [name, page] of [["share", share], ["mounted-share", mounted], ["grants", admin]] as const) {
        const layout = await page.evaluate(() => ({
          width: innerWidth, documentWidth: document.documentElement.scrollWidth,
          scrollOwners: [...document.querySelectorAll("*")]
            .filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight)
            .map(node => node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}.${node.className}`)
            .concat((document.scrollingElement?.scrollHeight ?? 0) > innerHeight ? ["document"] : []),
        }));
        expect(layout.documentWidth).toBeLessThanOrEqual(width);
        console.info("P4_BENEFITS_LAYOUT", name, width, theme, JSON.stringify(layout));
        await page.evaluate(() => {
          for (const node of document.querySelectorAll("*")) {
            if (/auto|scroll/.test(getComputedStyle(node).overflowY)) node.scrollTop = node.scrollHeight;
          }
          window.scrollTo(0, document.documentElement.scrollHeight);
        });
        await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}-end.png` });
      }
      // Then: compact layouts have no horizontal overflow and keep real controls usable.
      expect(await admin.getByRole("button", { name: "Review grant change" }).isEnabled()).toBe(true);
      const changed = await operator.context.request.put("/api/admin/project-benefits/deployment/local", {
        headers: { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken },
        data: { expectedVersion: grantVersion, benefits: { compileSeconds: 60, writableMembers: 1, historyDays: 7, trackChanges: false } },
      });
      expect(changed.status()).toBe(200);
      grantVersion += 1;
      for (const [name, page] of [["limited-share", share], ["limited-mounted", mounted]] as const) {
        try {
          await waitForRenderedText(page, "Selection required.");
        } catch (failure) {
          console.info("P4_LIMITED_FAILURE", {
            name, width, theme,
            rendered: await page.locator("body").innerText(),
            access: await (await owner.context.request.get(`/api/projects/${ids.project}/access?branch=main`)).json(),
          });
          await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}-failure.png` });
          throw failure;
        }
        await waitForRenderedText(page, "60 seconds");
        await waitForRenderedText(page, "7 days");
        await waitForRenderedText(page, "Not available");
        await page.evaluate(() => {
          for (const node of document.querySelectorAll("*")) {
            if (/auto|scroll/.test(getComputedStyle(node).overflowY)) node.scrollTop = 0;
          }
          window.scrollTo(0, 0);
        });
        await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}.png` });
      }
      await using member = await authenticatedContext(browser, app, { ...options, email: "mai@quire.local" });
      const memberPage = await member.context.newPage();
      await openPanel(memberPage, { view: "share", theme, live: false });
      await waitForRenderedText(memberPage, "Effective role: viewer");
      expect(await memberPage.getByLabel("Selection mode").count()).toBe(0);
      await memberPage.screenshot({ path: `${evidence}/member-readonly-${width}-${theme}.png` });
      const reloadSelection = async () => {
        const currentProject = resultSchema(endpoints.projectGet.output).parse(await (
          await owner.context.request.get(`/api/projects/${ids.project}?branch=main`)).json());
        if ("error" in currentProject) throw new TypeError(currentProject.error.message);
        await share.getByRole("button", { name: "Reload access" }).click();
        await waitForAttribute(share, { selector: "[data-writable-version]", name: "data-writable-version",
          value: String(currentProject.data.version) });
      };
      await reloadSelection();
      await share.getByLabel("Selection mode").selectOption("explicit");
      await share.getByLabel("Writable access for Mai Tran").uncheck();
      const reviewerSelected = share.waitForResponse(response => response.request().method() === "PUT"
        && new URL(response.url()).pathname.endsWith("/writable-members"));
      await share.getByRole("button", { name: "Save writable selection" }).click();
      const reviewerResponse = await reviewerSelected;
      if (reviewerResponse.status() !== 200) console.info("P4_REVIEWER_FAILURE", {
        status: reviewerResponse.status(), request: reviewerResponse.request().postData(),
        body: await reviewerResponse.text(),
        renderedVersion: await share.locator("[data-writable-version]").getAttribute("data-writable-version"),
        project: await (await owner.context.request.get(`/api/projects/${ids.project}?branch=main`)).json(),
        events: await app.application.runtime.db.all("SELECT seq,topic,payload_json FROM events WHERE aggregate_id=? ORDER BY seq DESC LIMIT 12", [ids.project]),
      });
      expect(reviewerResponse.status()).toBe(200);
      await waitForRenderedText(share, "Writable selection saved.");
      expect(await share.getByRole("button", { name: "Reload access" }).isEnabled()).toBe(true);
      for (const [name, page] of [["selected-reviewer-share", share], ["selected-reviewer-mounted", mounted]] as const) {
        await waitForRenderedText(page, "Assigned: reviewer · Effective: reviewer");
        await page.getByLabel("Writable access for Sam").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}.png` });
      }
      await reloadSelection();
      await share.getByLabel("Writable access for Sam").uncheck();
      await share.getByLabel("Writable access for Mai Tran").check();
      const editorSelected = share.waitForResponse(response => response.request().method() === "PUT"
        && new URL(response.url()).pathname.endsWith("/writable-members"));
      await share.getByRole("button", { name: "Save writable selection" }).click();
      const editorResponse = await editorSelected;
      if (editorResponse.status() !== 200) console.info("P4_SELECTION_FAILURE", {
        status: editorResponse.status(), request: editorResponse.request().postData(), body: await editorResponse.text(),
        events: await app.application.runtime.db.all("SELECT seq,topic,payload_json FROM events WHERE aggregate_id=? ORDER BY seq DESC LIMIT 12", [ids.project]),
      });
      expect(editorResponse.status()).toBe(200);
      await waitForRenderedText(share, "Writable selection saved.");
      expect(await share.getByRole("button", { name: "Reload access" }).isEnabled()).toBe(true);
      for (const [name, page] of [["selected-editor-share", share], ["selected-editor-mounted", mounted]] as const) {
        await waitForRenderedText(page, "Assigned: editor · Effective: editor");
        await page.getByLabel("Writable access for Mai Tran").focus();
        await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}.png` });
      }
      expect((await operator.context.request.put("/api/admin/project-benefits/deployment/local", {
        headers: { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken },
        data: { expectedVersion: grantVersion, benefits: { compileSeconds: 180, writableMembers: null, historyDays: null, trackChanges: true } },
      })).status()).toBe(200);
      grantVersion += 1;
      await waitForRenderedText(share, "Unlimited capacity");
      await reloadSelection();
      await share.getByLabel("Selection mode").selectOption("automatic");
      const automatic = share.waitForResponse(response => response.request().method() === "PUT"
        && new URL(response.url()).pathname.endsWith("/writable-members"));
      await share.getByRole("button", { name: "Save writable selection" }).click();
      const automaticResponse = await automatic;
      if (automaticResponse.status() !== 200) console.info("P4_AUTOMATIC_FAILURE", {
        status: automaticResponse.status(), request: automaticResponse.request().postData(),
        body: await automaticResponse.text(),
        renderedVersion: await share.locator("[data-writable-version]").getAttribute("data-writable-version"),
        project: await (await owner.context.request.get(`/api/projects/${ids.project}?branch=main`)).json(),
        events: await app.application.runtime.db.all("SELECT seq,topic,payload_json FROM events WHERE aggregate_id=? ORDER BY seq DESC LIMIT 12", [ids.project]),
      });
      expect(automaticResponse.status()).toBe(200);
    }
  }
}, 300_000);
