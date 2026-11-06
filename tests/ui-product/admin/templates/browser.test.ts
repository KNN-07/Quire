import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import type { Page } from "@playwright/test";
import { CoreProjects } from "../../../../services/core/base";
import { fixtureIds as ids } from "../../../fixtures/foundation";
import { bootstrapApplication } from "../../projects/bootstrap-template/application";
import { authenticatedContext, projectDocument, startEditorBrowser } from "../../../ui-editor/shared/browser";

test("composed institutional catalogue publishes reviewed snapshots, withdraws, republishes and preserves copies", async () => {
  const evidence = `docs/evidence/p73-institutional-templates/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await bootstrapApplication();
    root = app.dataDir;
    console.info("TEMPLATES_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    // Provision membership only in this owned fixture. Existing operator authority performs curation.
    await app.application.runtime.db.run(
      "INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',1,?)",
      [crypto.randomUUID(), ids.institution, ids.operator, app.application.runtime.clock.now()]);
    await app.application.runtime.db.run(
      "INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'admin',1,?)",
      [crypto.randomUUID(), ids.institution, ids.mai, app.application.runtime.clock.now()]);
    await using browser = await startEditorBrowser();
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    await using member = await authenticatedContext(browser, app, { email: "mai@quire.local" });
    await using outsider = await authenticatedContext(browser, app, { email: "outsider@quire.local" });
    const headers = { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken, "idempotency-key": crypto.randomUUID() };
    const created = await operator.context.request.post("/api/projects", {
      headers, data: { name: "Institutional source", workspaceId: ids.institution, origin: { kind: "blank" } },
    });
    const result = resultSchema(endpoints.projectCreate.output).parse(await created.json());
    if (!("data" in result)) throw new Error(result.error.message);
    const source = result.data;
    const service = app.application.runtime.services.get("projects");
    if (!(service instanceof CoreProjects)) throw new Error("Native project service required");
    const scope = { projectId: source.id, branch: source.defaultBranch };
    const original = (await service.readDocument(scope, source.settings.mainFileId)).text;
    const page = await operator.context.newPage();
    await page.goto("/admin/templates", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Create template", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Create template", exact: true });
    await form.getByLabel("Name", { exact: true }).fill("Institutional report");
    await form.getByLabel("Category", { exact: true }).fill("Reports");
    await form.getByLabel("License", { exact: true }).fill("MIT");
    await form.getByRole("combobox", { name: /^Visibility/ }).selectOption("organization");
    await form.getByRole("combobox", { name: /^Source project/ }).selectOption(source.id);
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/templates" && response.request().method() === "POST");
    await form.getByRole("button", { name: "Save template", exact: true }).click();
    let versionResult = resultSchema(endpoints.templateCreate.output).parse(await (await saved).json());
    if (!("data" in versionResult)) throw new Error(versionResult.error.message);
    let version = versionResult.data;
    const first = version;
    const row = page.getByRole("row").filter({ has: page.getByText("Institutional report", { exact: true }) });
    const advance = async (label: string, action: string) => {
      const refreshed = page.waitForResponse(entry => new URL(entry.url()).pathname === "/api/admin/templates");
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await refreshed;
      await row.getByRole("button", { name: label, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: `${label} template`, exact: true });
      const response = page.waitForResponse(entry => new URL(entry.url()).pathname === `/api/templates/${version.templateId}/${action}`);
      await dialog.getByRole("button", { name: label, exact: true }).click();
      const parsed = resultSchema(endpoints.templatePublish.output).parse(await (await response).json());
      if (!("data" in parsed)) throw new Error(parsed.error.message);
      version = parsed.data;
      await dialog.waitFor({ state: "hidden" });
    };
    await advance("Submit", "submit");
    expect((await member.context.request.get(`/api/templates/${version.templateId}`)).status()).toBe(404);
    await advance("Approve", "approve");
    expect((await member.context.request.get(`/api/templates/${version.templateId}`)).status()).toBe(404);
    const immutable = await operator.context.request.patch(`/api/templates/${version.templateId}`, {
      headers, data: { expectedVersion: version.version, license: "Changed" },
    });
    expect(immutable.status()).toBe(409);
    const denied = await outsider.context.request.post(`/api/templates/${version.templateId}/publish`, {
      headers: { origin: app.url.origin, "x-csrf-token": outsider.session.csrfToken },
      data: { expectedVersion: version.version, versionId: version.id },
    });
    expect(denied.status()).toBe(403);
    await advance("Publish", "publish");
    expect((await outsider.context.request.get(`/api/templates/${version.templateId}`)).status()).toBe(404);
    expect((await member.context.request.get(`/api/templates/${version.templateId}`)).status()).toBe(200);
    const memberPage = await member.context.newPage();
    const portal = async (target: Page) => {
      await target.goto("/institutions/quire-institute", { waitUntil: "domcontentloaded" });
      await target.getByRole("heading", { name: "Featured templates", exact: true }).waitFor();
    };
    await portal(memberPage);
    expect(await memberPage.getByRole("button", { name: "Use template Institutional report", exact: true }).count()).toBe(0);
    const featuring = memberPage.waitForResponse(response => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/organizations/${ids.institution}/templates/${version.templateId}`);
    await memberPage.getByLabel("Published template", { exact: true }).selectOption(version.id);
    await memberPage.getByRole("button", { name: "Feature selected version", exact: true }).click();
    const featureResponse = await featuring;
    expect(featureResponse.status()).toBe(200);
    const featureResult = resultSchema(endpoints.institutionTemplateSelect.output).parse(await featureResponse.json());
    if (!("data" in featureResult)) throw new Error(featureResult.error.message);
    version = featureResult.data;
    const card = memberPage.getByRole("button", { name: "Use template Institutional report", exact: true });
    await card.waitFor();
    for (const width of [1440, 390]) {
      await memberPage.setViewportSize({ width, height: 900 });
      await card.scrollIntoViewIfNeeded();
      expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await memberPage.screenshot({ path: `${evidence}/organization-${width}.png` });
    }
    await memberPage.setViewportSize({ width: 1440, height: 900 });
    await card.click();
    const copyDialog = memberPage.getByRole("dialog", { name: "New project", exact: true });
    await copyDialog.getByLabel("Project name", { exact: true }).fill("Independent institutional copy");
    const copying = memberPage.waitForResponse(response => new URL(response.url()).pathname === "/api/projects" && response.request().method() === "POST");
    await copyDialog.getByRole("button", { name: "Create from template", exact: true }).click();
    const copyResult = resultSchema(endpoints.projectCreate.output).parse(await (await copying).json());
    if (!("data" in copyResult)) throw new Error(copyResult.error.message);
    const copy = copyResult.data;
    expect(copy.ownerId).toBe(ids.mai);
    const copyScope = { projectId: copy.id, branch: copy.defaultBranch, fileId: copy.settings.mainFileId };
    expect((await projectDocument(member.context, copyScope)).text).toBe(original);
    await portal(memberPage);
    const removing = memberPage.waitForResponse(response => response.request().method() === "DELETE"
      && new URL(response.url()).pathname === `/api/organizations/${ids.institution}/templates/${version.templateId}`);
    await memberPage.getByRole("button", { name: "Remove featured Institutional report", exact: true }).click();
    const removalResponse = await removing;
    expect(removalResponse.status()).toBe(200);
    const removalResult = resultSchema(endpoints.institutionTemplateRemove.output).parse(await removalResponse.json());
    if (!("data" in removalResult)) throw new Error(removalResult.error.message);
    version = { ...version, version: removalResult.data.version };
    await memberPage.getByText("No featured templates are currently available.", { exact: true }).waitFor();
    await memberPage.screenshot({ path: `${evidence}/unfeatured-portal.png` });
    await memberPage.getByLabel("Published template", { exact: true }).selectOption(version.id);
    const restored = memberPage.waitForResponse(response => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/organizations/${ids.institution}/templates/${version.templateId}`);
    await memberPage.getByRole("button", { name: "Feature selected version", exact: true }).click();
    const restoreResponse = await restored;
    expect(restoreResponse.status()).toBe(200);
    const restoreResult = resultSchema(endpoints.institutionTemplateSelect.output).parse(await restoreResponse.json());
    if (!("data" in restoreResult)) throw new Error(restoreResult.error.message);
    version = restoreResult.data;
    await memberPage.getByRole("button", { name: "Use template Institutional report", exact: true }).waitFor();
    await memberPage.screenshot({ path: `${evidence}/republished-portal.png` });
    await advance("Unpublish", "unpublish");
    expect((await member.context.request.get(`/api/templates/${version.templateId}`)).status()).toBe(404);
    await portal(memberPage);
    await memberPage.getByText("No featured templates are currently available.", { exact: true }).waitFor();
    const withdrawn = await operator.context.request.post(`/api/templates/${version.templateId}/publish`, {
      headers, data: { versionId: version.id, expectedVersion: version.version },
    });
    expect(withdrawn.status()).toBe(409);
    await row.getByRole("button", { name: "New draft", exact: true }).click();
    await page.getByRole("dialog", { name: "Create a new template draft", exact: true })
      .getByRole("button", { name: "Create draft", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit template draft", exact: true });
    await edit.waitFor();
    const marker = "\n% Resubmitted institutional source\n";
    await service.serialized(scope, async lease => service.commitSource({
      lease, actorId: ids.operator, scope, expectedRevision: (await service.getBranch(scope)).revision,
      inputs: (await service.listFiles(scope)).map(file => file.id === source.settings.mainFileId
        ? { file, bytes: new TextEncoder().encode(original + marker) } : { file }),
    }));
    await edit.getByRole("combobox", { name: /^Source project/ }).selectOption(source.id);
    const patched = page.waitForResponse(response => new URL(response.url()).pathname === `/api/templates/${version.templateId}` && response.request().method() === "PATCH");
    await edit.getByRole("button", { name: "Save template", exact: true }).click();
    versionResult = resultSchema(endpoints.templatePatch.output).parse(await (await patched).json());
    if (!("data" in versionResult)) throw new Error(versionResult.error.message);
    version = versionResult.data;
    await edit.waitFor({ state: "hidden" });
    const featuredItems = async () => {
      const response = await member.context.request.get(`/api/organizations/${ids.institution}/templates`);
      const parsed = resultSchema(endpoints.institutionTemplates.output).parse(await response.json());
      if (!("data" in parsed)) throw new Error(parsed.error.message);
      return parsed.data.items;
    };
    expect(await featuredItems()).toHaveLength(0);
    await advance("Submit", "submit");
    expect(await featuredItems()).toHaveLength(0);
    await advance("Approve", "approve");
    expect(await featuredItems()).toHaveLength(0);
    await advance("Publish", "publish");
    expect(await featuredItems()).toHaveLength(0);
    expect(version.snapshotId).not.toBe(first.snapshotId);
    expect((await projectDocument(member.context, copyScope)).text).toBe(original);
    await portal(memberPage);
    await memberPage.getByLabel("Published template", { exact: true }).selectOption(version.id);
    const republishing = memberPage.waitForResponse(response => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/organizations/${ids.institution}/templates/${version.templateId}`);
    await memberPage.getByRole("button", { name: "Feature selected version", exact: true }).click();
    const republishResponse = await republishing;
    expect(republishResponse.status()).toBe(200);
    const republishResult = resultSchema(endpoints.institutionTemplateSelect.output).parse(await republishResponse.json());
    if (!("data" in republishResult)) throw new Error(republishResult.error.message);
    version = republishResult.data;
    expect((await featuredItems()).map(item => item.id)).toEqual([version.id]);
    await memberPage.getByRole("button", { name: "Use template Institutional report", exact: true }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await row.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/published-${width}.png` });
      await memberPage.setViewportSize({ width, height: 900 });
      await memberPage.getByRole("heading", { name: "Featured templates", exact: true }).scrollIntoViewIfNeeded();
      expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await memberPage.screenshot({ path: `${evidence}/reselected-portal-${width}.png` });
    }
    console.info("TEMPLATES_VERIFIED", { evidence, first, final: version, copyId: copy.id });
    await page.close();
    await memberPage.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("TEMPLATES_ROOT_ABSENT", root);
}, 180_000);
