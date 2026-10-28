import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../fixtures/foundation";
import { authenticatedContext, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../ui-editor/shared";
import { openPanel } from "../ui-editor/review/browser-harness";

test("edits explicit operator grants, retains tombstone versions and rejects stale or ordinary sessions", async () => {
  // Given: real operator and member sessions on actual native services.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using operator = await authenticatedContext(browser, app, {
    email: "operator@quire.local", viewport: { width: 1440, height: 900 },
  });
  await using member = await authenticatedContext(browser, app, { email: "mai@quire.local" });
  const page = await operator.context.newPage();
  await page.goto("/admin/benefits", { waitUntil: "domcontentloaded" });
  await waitForRenderedText(page, "Grant configured");
  // When: an operator reviews and confirms a deployment grant with finite limits.
  await page.getByLabel("Compile seconds", { exact: true }).fill("60");
  await page.getByLabel("Unlimited collaborators (null)").uncheck();
  await page.getByLabel("Writable collaborators", { exact: true }).fill("1");
  await page.getByLabel("Unlimited history (null)").uncheck();
  await page.getByLabel("History days", { exact: true }).fill("7");
  await page.getByLabel("Allow tracked proposals").uncheck();
  await page.getByRole("button", { name: "Review grant change" }).click();
  expect(await page.getByRole("button", { name: "Confirm grant change" }).isDisabled()).toBe(true);
  await page.screenshot({ path: "docs/evidence/p4-benefits-controls/grant-confirmation-1440-light.png" });
  await page.getByLabel("I reviewed this scope, version and grant change.").check();
  const saved = page.waitForResponse(response => response.request().method() === "PUT"
    && new URL(response.url()).pathname === "/api/admin/project-benefits/deployment/local");
  await page.getByRole("button", { name: "Confirm grant change" }).click();
  expect((await saved).status()).toBe(200);
  await waitForRenderedText(page, "Grant saved at version 1");
  // Then: reloading reads the persisted values, and ordinary members cannot grant benefits.
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(page, "Grant configured");
  expect(await page.getByLabel("Compile seconds", { exact: true }).inputValue()).toBe("60");
  expect(await page.getByLabel("Writable collaborators", { exact: true }).inputValue()).toBe("1");
  expect(await page.getByLabel("Allow tracked proposals").isChecked()).toBe(false);
  const denied = await member.context.request.put("/api/admin/project-benefits/deployment/local", {
    headers: { origin: app.url.origin, "x-csrf-token": member.session.csrfToken },
    data: { expectedVersion: 1, benefits: { compileSeconds: 600, writableMembers: null, historyDays: null, trackChanges: true } },
  });
  expect(denied.status()).toBe(403);
  const deniedPage = await member.context.newPage();
  await deniedPage.goto("/admin/benefits", { waitUntil: "domcontentloaded" });
  await waitForRenderedText(deniedPage, "Operator access denied");
  expect(await deniedPage.getByLabel("Grant scope").count()).toBe(0);
  await deniedPage.screenshot({ path: "docs/evidence/p4-benefits-controls/operator-denied.png" });

  // Given: a second operator changes the currently loaded grant.
  expect((await operator.context.request.put("/api/admin/project-benefits/deployment/local", {
    headers: { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken },
    data: { expectedVersion: 1, benefits: { compileSeconds: 70, writableMembers: 2, historyDays: null, trackChanges: true } },
  })).status()).toBe(200);
  // When: the first form submits its older version.
  await page.getByRole("button", { name: "Review grant change" }).click();
  await page.getByLabel("I reviewed this scope, version and grant change.").check();
  const conflicted = page.waitForResponse(response => response.request().method() === "PUT"
    && new URL(response.url()).pathname === "/api/admin/project-benefits/deployment/local");
  await page.getByRole("button", { name: "Confirm grant change" }).click();
  expect((await conflicted).status()).toBe(409);
  // Then: it requires an explicit reload, not an automatic overwrite.
  await waitForRenderedText(page, "VERSION_CONFLICT");
  expect(await page.getByRole("button", { name: "Review grant change" }).isDisabled()).toBe(true);
  await page.screenshot({ path: "docs/evidence/p4-benefits-controls/grant-stale.png" });
  await page.getByRole("button", { name: "Reload current grant" }).click();
  await waitForRenderedText(page, "Version 2");
  expect(await page.getByLabel("Compile seconds", { exact: true }).inputValue()).toBe("70");

  // Given: a real existing user with no explicit grant.
  await page.getByLabel("Grant scope").selectOption("user");
  await page.getByLabel("Scope key").fill(ids.kien);
  await page.getByRole("button", { name: "Load grant", exact: true }).click();
  await waitForRenderedText(page, "No grant contribution");
  // When: an explicit user contribution is saved and then withdrawn.
  await page.getByLabel("Compile seconds", { exact: true }).fill("120");
  await page.getByLabel("Unlimited collaborators (null)").check();
  await page.getByLabel("Unlimited history (null)").check();
  await page.getByLabel("Allow tracked proposals").check();
  await page.getByRole("button", { name: "Review grant change" }).click();
  await page.getByLabel("I reviewed this scope, version and grant change.").check();
  await page.getByRole("button", { name: "Confirm grant change" }).click();
  await waitForRenderedText(page, "Grant saved at version 1");
  await page.getByRole("button", { name: "Withdraw grant…" }).click();
  await page.getByLabel("I reviewed this scope, version and grant change.").check();
  await page.getByRole("button", { name: "Confirm grant change" }).click();
  await waitForRenderedText(page, "Grant withdrawn at version 2");
  // Then: withdrawal retains its version; the audit contains the actual operation.
  const audit = await app.application.runtime.db.all("SELECT event,details_json FROM audit_entries WHERE event='project-benefits.updated'");
  expect(audit.length).toBe(4);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(page, "Grant configured");
  await page.getByLabel("Grant scope").selectOption("user");
  await page.getByLabel("Scope key").fill(ids.kien);
  await page.getByRole("button", { name: "Load grant", exact: true }).click();
  await waitForRenderedText(page, "No grant contribution");
  const withdrawn = resultSchema(endpoints.adminProjectBenefitsGet.output).parse(await (
    await operator.context.request.get(`/api/admin/project-benefits/user/${ids.kien}`)).json());
  if ("error" in withdrawn) throw new TypeError(withdrawn.error.message);
  expect(withdrawn.data).toEqual({ benefits: null, version: 2 });
}, 300_000);

test("refreshes live capacity, selects actual membership IDs and preserves assigned roles and proposals", async () => {
  // Given: real owner, Editor, Reviewer and operator sessions before the downgrade.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using owner = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
  await using editor = await authenticatedContext(browser, app, { email: "mai@quire.local" });
  await using reviewer = await authenticatedContext(browser, app, { email: "sam@quire.local" });
  await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
  const ownerPage = await owner.context.newPage();
  const editorPage = await editor.context.newPage();
  const reviewerPage = await reviewer.context.newPage();
  await openPanel(reviewerPage, { view: "review", select: "article" });
  await reviewerPage.getByLabel("Replacement text").fill("report");
  const proposalCreated = reviewerPage.waitForResponse(response =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/suggestions"));
  await reviewerPage.getByRole("button", { name: "Propose replacement" }).click();
  const proposalResponse = await proposalCreated;
  expect(proposalResponse.status()).toBe(200);
  const proposal = resultSchema(endpoints.suggestionCreate.output).parse(await proposalResponse.json());
  if ("error" in proposal) throw new TypeError(proposal.error.message);
  await Promise.all([openPanel(ownerPage, { view: "share" }), openPanel(editorPage, { view: "share", live: false })]);
  expect(await editorPage.getByRole("heading", { name: "Writable collaborators", exact: true }).count()).toBe(0);
  const headers = { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken };
  const beforeHistory = await app.application.runtime.db.all("SELECT * FROM history_versions");
  const beforeSuggestions = await app.application.runtime.db.all("SELECT * FROM suggestions");
  const beforeEdits = await app.application.runtime.db.all("SELECT * FROM suggestion_edits");
  expect(beforeHistory.length).toBeGreaterThan(0);
  expect(beforeSuggestions.length).toBe(1);
  // When: an operator reduces the owner baseline while both surfaces remain open.
  const authorityRefreshed = editorPage.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/effective-access") && response.request().method() === "GET");
  const downgraded = await operator.context.request.put("/api/admin/project-benefits/deployment/local", {
    headers, data: { expectedVersion: 0, benefits: { compileSeconds: 60, writableMembers: 1, historyDays: 7, trackChanges: false } },
  });
  expect(downgraded.status()).toBe(200);
  await authorityRefreshed;
  // Then: both current controls derive from real events; the Editor becomes effective Viewer.
  await waitForRenderedText(ownerPage, "Selection required.");
  await waitForRenderedText(editorPage, "Effective role: viewer");
  await waitForRenderedText(editorPage, "60 seconds");
  const deniedInventory = await editor.context.request.get(`/api/projects/${ids.project}/access?branch=main`);
  expect(deniedInventory.status()).toBe(403);
  const deniedSelect = await editor.context.request.put(`/api/projects/${ids.project}/writable-members`, {
    headers: { origin: app.url.origin, "x-csrf-token": editor.session.csrfToken },
    data: { memberIds: [], expectedVersion: 0 },
  });
  expect(deniedSelect.status()).toBe(403);
  await ownerPage.screenshot({ path: "docs/evidence/p4-benefits-controls/selection-required-1440-light.png", fullPage: true });
  // Given: the owner chooses an explicit subset of current actual memberships.
  await ownerPage.getByLabel("Selection mode").selectOption("explicit");
  await ownerPage.getByLabel("Writable access for Mai Tran").uncheck();
  const selected = ownerPage.waitForResponse(response => response.request().method() === "PUT"
    && new URL(response.url()).pathname.endsWith("/writable-members"));
  // When: only the assigned Reviewer is selected.
  await ownerPage.getByRole("button", { name: "Save writable selection" }).click();
  const selectionResponse = await selected;
  expect(selectionResponse.status()).toBe(200);
  const inventoryResponse = await owner.context.request.get(`/api/projects/${ids.project}/access?branch=main`);
  const inventory = resultSchema(endpoints.accessGet.output).parse(await inventoryResponse.json());
  if ("error" in inventory) throw new TypeError(inventory.error.message);
  const samMembership = inventory.data.members.find(member => member.user.id === ids.sam)?.memberId;
  if (!samMembership) throw new TypeError("Reviewer membership missing from real owner inventory");
  expect(inventory.data.writableSelection.memberIds).toEqual([samMembership]);
  expect(samMembership).not.toBe(ids.sam);
  // Then: Reviewer can comment but not propose while tracking is unavailable, Editor cannot write.
  await waitForRenderedText(ownerPage, "Writable selection saved.");
  const commented = await reviewer.context.request.post(`/api/projects/${ids.project}/threads`, {
    headers: { origin: app.url.origin, "x-csrf-token": reviewer.session.csrfToken, "idempotency-key": crypto.randomUUID() },
    data: { scope: { projectId: ids.project, branch: "main" }, body: "Selected Reviewer comment", expectedVersion: 0 },
  });
  expect(commented.status()).toBe(200);
  const proposalDenied = await reviewer.context.request.post(`/api/projects/${ids.project}/suggestions`, {
    headers: { origin: app.url.origin, "x-csrf-token": reviewer.session.csrfToken, "idempotency-key": crypto.randomUUID() },
    data: { scope: { projectId: ids.project, branch: "main" }, expectedVersion: 0,
      edits: proposal.data.edits.map(edit => ({ fileId: edit.fileId, anchor: edit.anchor,
        before: edit.before, after: edit.after, baseRevision: edit.baseRevision })) },
  });
  expect(proposalDenied.status()).toBe(403);
  const sourceDenied = await editor.context.request.post(`/api/projects/${ids.project}/files`, {
    headers: { origin: app.url.origin, "x-csrf-token": editor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
    data: { scope: { projectId: ids.project, branch: "main" }, path: "denied.tex", kind: "file", text: "denied", expectedVersion: 0 },
  });
  expect(sourceDenied.status()).toBe(403);
  expect(await app.application.runtime.db.all("SELECT * FROM suggestions")).toEqual(beforeSuggestions);
  expect(await app.application.runtime.db.all("SELECT * FROM suggestion_edits")).toEqual(beforeEdits);
  expect(await app.application.runtime.db.all("SELECT * FROM history_versions")).toEqual(beforeHistory);
  await ownerPage.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(ownerPage, "Assigned: reviewer · Effective: reviewer");
  expect(await ownerPage.getByLabel("Writable access for Sam").isChecked()).toBe(true);
  expect(await ownerPage.getByLabel("Writable access for Mai Tran").isChecked()).toBe(false);
  // Given: an unsaved local choice, and a concurrent owner selection change.
  await ownerPage.getByLabel("Writable access for Sam").uncheck();
  const ownerHeaders = { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken };
  expect((await owner.context.request.put(`/api/projects/${ids.project}/writable-members`, {
    headers: ownerHeaders, data: { memberIds: [], expectedVersion: 1 },
  })).status()).toBe(200);
  // Then: live invalidation preserves the draft but requires deliberate reload.
  await waitForRenderedText(ownerPage, "Access changed while this selection was open.");
  expect((await owner.context.request.put(`/api/projects/${ids.project}/writable-members`, {
    headers: ownerHeaders, data: { memberIds: [samMembership], expectedVersion: 1 },
  })).status()).toBe(409);
  expect(await ownerPage.getByRole("button", { name: "Save writable selection" }).isDisabled()).toBe(true);
  await ownerPage.screenshot({ path: "docs/evidence/p4-benefits-controls/selection-stale.png", fullPage: true });
  await ownerPage.getByRole("button", { name: "Reload access" }).click();
  await waitForRenderedText(ownerPage, "0 selected of 1 places");
  // When: the owner selects the assigned Editor instead.
  await ownerPage.getByLabel("Writable access for Mai Tran").check();
  const editorSelected = ownerPage.waitForResponse(response => response.request().method() === "PUT"
    && new URL(response.url()).pathname.endsWith("/writable-members"));
  await ownerPage.getByRole("button", { name: "Save writable selection" }).click();
  expect((await editorSelected).status()).toBe(200);
  // Then: the same already-open Editor surface regains effective Editor authority.
  await waitForRenderedText(editorPage, "Effective role: editor");
  const sourceAllowed = await editor.context.request.post(`/api/projects/${ids.project}/files`, {
    headers: { origin: app.url.origin, "x-csrf-token": editor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
    data: { scope: { projectId: ids.project, branch: "main" }, path: "selected.tex", kind: "file", text: "Selected Editor", expectedVersion: 0 },
  });
  expect(sourceAllowed.status()).toBe(200);
}, 300_000);
