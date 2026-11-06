import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { IdSchema, endpoints, resultSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../../../fixtures/foundation";
import { bootstrapApplication } from "../../projects/bootstrap-template/application";
import { authenticatedContext, startEditorBrowser } from "../../../ui-editor/shared/browser";

test("mobile institution featured section shows all curation actions", async () => {
  const evidence = `docs/evidence/p73-institutional-templates/mobile-correction-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await bootstrapApplication();
    root = app.dataDir;
    console.info("TEMPLATE_CAPTURE_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await app.application.runtime.db.run(
      "INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'admin',1,?)",
      [crypto.randomUUID(), ids.institution, ids.mai, app.application.runtime.clock.now()]);
    await using browser = await startEditorBrowser();
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    await using admin = await authenticatedContext(browser, app, { email: "mai@quire.local", viewport: { width: 390, height: 900 } });
    const source = z.object({ source_project_id: IdSchema }).parse(
      await app.application.runtime.db.get("SELECT source_project_id FROM templates WHERE name='Starter Article'"));
    const headers = { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken };
    const created = await operator.context.request.post("/api/templates", {
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      data: { name: "Institutional report", category: "Reports", description: "", license: "MIT",
        visibility: "public", sourceProjectId: source.source_project_id },
    });
    const parsed = resultSchema(endpoints.templateCreate.output).parse(await created.json());
    if (!("data" in parsed)) throw new Error(parsed.error.message);
    let version = parsed.data;
    for (const action of ["submit", "approve", "publish"]) {
      const response = await operator.context.request.post(`/api/templates/${version.templateId}/${action}`, {
        headers, data: { expectedVersion: version.version, ...(action === "submit" ? {} : { versionId: version.id }) },
      });
      const result = resultSchema(endpoints.templatePublish.output).parse(await response.json());
      if (!("data" in result)) throw new Error(result.error.message);
      version = result.data;
    }
    const page = await admin.context.newPage();
    await page.goto("/institutions/quire-institute", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Published template", { exact: true }).selectOption(version.id);
    await page.getByRole("button", { name: "Feature selected version", exact: true }).click();
    const section = page.getByRole("article", { name: "Featured templates", exact: true });
    await section.getByRole("button", { name: "Use template Institutional report", exact: true }).waitFor();
    await section.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const name of ["Use template Institutional report", "Remove featured Institutional report", "Feature selected version", "Refresh templates"])
      expect(await section.getByRole("button", { name, exact: true }).isVisible()).toBe(true);
    await section.screenshot({ path: `${evidence}/featured-actions-390.png` });
    await page.screenshot({ path: `${evidence}/portal-full-390.png`, fullPage: true });
    console.info("TEMPLATE_CAPTURE_VERIFIED", { evidence, templateId: version.templateId });
    await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("TEMPLATE_CAPTURE_ROOT_ABSENT", root);
}, 180_000);
