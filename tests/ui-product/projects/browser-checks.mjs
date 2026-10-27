import assert from "node:assert/strict";
import { ids } from "./protocol-fixture.mjs";

export async function waitDom(page, condition) {
  await page.evaluate(({ selector = "body", text, absent = false }) => new Promise((resolve, reject) => {
    const check = () => {
      const node = document.querySelector(selector);
      const present = Boolean(node && (text === undefined || node.textContent.includes(text)));
      return absent ? !present : present;
    };
    const observer = new MutationObserver(() => { if (check()) { clearTimeout(deadline); observer.disconnect(); resolve(true); } });
    const deadline = setTimeout(() => { observer.disconnect(); reject(new Error(`DOM condition timed out: ${selector} ${text ?? ""}`)); }, 8000);
    observer.observe(document.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
    if (check()) { clearTimeout(deadline); observer.disconnect(); resolve(true); }
  }), condition);
}
export async function checkBehavior(page, fixture, zipPath) {
  const button = name => page.getByRole("button", { name, exact: true });
  const dialog = () => page.getByRole("dialog");
  const field = name => page.getByRole("textbox", { name, exact: true });
  await button("Latent Dynamics Note").waitFor({ state: "visible" });
  // Given independently versioned projects. When both are archived. Then only that selected set changes.
  await page.getByRole("checkbox", { name: "Select all projects on this page" }).check();
  await button("Archive").click();
  await waitDom(page, { text: "Latent Dynamics Note", absent: true });
  const archive = fixture.calls.find(call => call.name === "projectBulk");
  assert.deepEqual(archive.input.body.items.map(item => item.expectedVersion).sort(), [3, 7]);
  assert.equal(fixture.projects.every(item => item.state === "archived"), true);
  await button("Archived").click();
  await button("Latent Dynamics Note").waitFor({ state: "visible" });
  await page.getByRole("checkbox", { name: "Select all projects on this page" }).check();
  await button("Restore").click();
  await waitDom(page, { selector: "tbody", absent: true });
  await button("All projects").click();
  await button("Latent Dynamics Note").waitFor({ state: "visible" });
  // Given tags and two projects. When the user filters and sorts. Then typed query fields drive visible results.
  await field("Search projects and templates").fill("Mai");
  await button("Lab seminar").waitFor({ state: "visible" });
  await waitDom(page, { text: "Latent Dynamics Note", absent: true });
  await field("Search projects and templates").fill("");
  await page.getByRole("combobox", { name: "Sort by", exact: true }).selectOption("title");
  await page.getByRole("combobox", { name: "Direction", exact: true }).selectOption("asc");
  await button("Latent Dynamics Note").waitFor({ state: "visible" });
  assert.ok(fixture.calls.some(call => call.name === "projectList" && call.input.query.sort === "title" && call.input.query.direction === "asc"));
  // Given a non-member project. When adding a tag to the selected set. Then its existing set is preserved.
  await page.getByRole("checkbox", { name: "Select Lab seminar", exact: true }).check();
  await page.getByRole("combobox", { name: "Tag", exact: true }).selectOption(ids.tag);
  await button("Add tag to selected").click();
  await waitDom(page, { selector: ".p-bulk", absent: true });
  assert.deepEqual(fixture.projects.find(item => item.id === ids.shared).tagIds, [ids.tag]);
  // Given a project. When copied with a new name. Then navigation uses the returned new ID.
  await button("Project actions for Latent Dynamics Note").click();
  await field("Project title").fill("Independent copy");
  await button("Make a copy").click();
  await waitDom(page, { selector: "output", text: "/edit" });
  assert.ok(fixture.projects.some(item => item.name === "Independent copy"));
  await button("Close dialog").click();
  // Given an owned project. When deletion is confirmed. Then it is removed, never restored as an undo.
  await button("Refresh projects").click();
  await button("Independent copy").waitFor({ state: "visible" });
  await button("Project actions for Independent copy").click();
  assert.equal(await page.evaluate(() => [...document.querySelectorAll("button")].find(node => node.textContent === "Permanently delete").disabled), true);
  await field("Type the project title to permanently delete").fill("Independent copy");
  await button("Permanently delete").click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(fixture.projects.some(item => item.name === "Independent copy"), false);
  // Given the blank mode. When submitting settings. Then a real create followed by a versioned patch occurs.
  await button("Blank project").click();
  await field("Project name").fill("Created blank");
  await page.getByRole("combobox", { name: "Compiler", exact: true }).selectOption("xelatex");
  await button("Create project").click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(fixture.projects.find(item => item.name === "Created blank").settings.engine, "xelatex");
  assert.equal(fixture.calls.findLast(call => call.name === "projectCreate").input.body.origin.kind, "example");
  // Given a template. When selected. Then its immutable version ID is sent, not its gallery ID.
  await button("New project").click();
  await button("Select template Conference paper").click();
  await field("Project name").fill("Created template");
  await button("Create from template").click();
  await dialog().waitFor({ state: "hidden" });
  assert.deepEqual(fixture.calls.findLast(call => call.name === "projectCreate").input.body.origin, { kind: "template", templateVersionId: ids.template });
  // Given unavailable import providers. When every import mode is submitted. Then the actual error remains visible.
  for (const mode of [
    { open: "Import from GitHub", submit: "Import repository" },
    { open: "Clone git URL", submit: "Clone and create" },
    { open: "Upload .zip", submit: "Upload and create" },
  ]) {
    const before = fixture.projects.length;
    await button(mode.open).click();
    if (mode.open === "Upload .zip") await page.getByLabel("Choose file", { exact: true }).setInputFiles(zipPath);
    else await field("Repository URL").fill("https://example.edu/paper.git");
    await button(mode.submit).click();
    await waitDom(page, { selector: "dialog", text: "PROVIDER_UNCONFIGURED" });
    assert.equal(fixture.projects.length, before);
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "hidden" });
  }
  // Given a server conflict. When archiving. Then no local success is invented and selection survives.
  fixture.failNext("projectBulk");
  await page.getByRole("checkbox", { name: "Select Latent Dynamics Note", exact: true }).check();
  await button("Archive").click();
  await waitDom(page, { text: "CONFLICT:" });
  assert.equal(fixture.projects.find(item => item.id === ids.project).state, "active");
  assert.equal(await page.evaluate(() => document.querySelector('input[aria-label="Select Latent Dynamics Note"]').checked), true);
  await button("Clear selection").click();
  // Given template categories. When one category is chosen. Then unrelated templates disappear.
  await button("Theses").click();
  await button("Use template Thesis").waitFor({ state: "visible" });
  await waitDom(page, { selector: 'button[aria-label="Use template Conference paper"]', absent: true });
  await button("All").click();
  // Given tag management. When a tag is created and renamed. Then persisted responses drive the navigation.
  await button("New tag").click();
  await field("Tag name").fill("Coursework");
  await field("Tag color (HEX or RGB)").fill("rgb(14, 110, 102)");
  await button("Save tag").click();
  await dialog().waitFor({ state: "hidden" });
  await button("Edit tag Coursework").waitFor({ state: "visible" });
  assert.equal(fixture.tags.find(tag => tag.name === "Coursework").colorHex, "#0e6e66");
  await button("Edit tag Coursework").click();
  await field("Tag name").fill("Notes");
  await button("Save tag").click();
  await dialog().waitFor({ state: "hidden" });
  await button("Edit tag Notes").waitFor({ state: "visible" });
  await button("Edit tag Notes").click();
  await field("Tag color (HEX or RGB)").fill("unsaved invalid color");
  await button("Delete tag").click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(fixture.tags.some(tag => tag.name === "Notes"), false);
  // Given a selected project. When trashed and restored. Then list state follows server state.
  await page.getByRole("checkbox", { name: "Select Latent Dynamics Note", exact: true }).check();
  await button("Move to trash").click();
  await waitDom(page, { selector: 'input[aria-label="Select Latent Dynamics Note"]', absent: true });
  await button("Trash").click();
  await button("Latent Dynamics Note").waitFor({ state: "visible" });
  await page.getByRole("checkbox", { name: "Select Latent Dynamics Note", exact: true }).check();
  await button("Restore").click();
  await waitDom(page, { selector: "tbody", absent: true });
  await button("All projects").click();
  await button("Latent Dynamics Note").waitFor({ state: "visible" });
  // Given completed source export. When downloading. Then the authenticated byte route is requested.
  await page.getByRole("checkbox", { name: "Select Latent Dynamics Note", exact: true }).check();
  await button("Download source").click();
  await button("Download source ZIP").waitFor({ state: "visible" });
  const downloaded = fixture.whenCalled("operationDownload");
  await button("Download source ZIP").click();
  await downloaded;
  await waitDom(page, { selector: ".p-bulk", absent: true });
  // Given a settings failure after create. When retried. Then the existing project is patched, not duplicated.
  fixture.failNext("projectPatch");
  await button("Blank project").click();
  await field("Project name").fill("Settings retry");
  await button("Create project").click();
  await waitDom(page, { selector: "dialog", text: "CONFLICT:" });
  await button("Retry project settings").waitFor({ state: "visible" });
  const count = fixture.calls.filter(call => call.name === "projectCreate").length;
  await button("Retry project settings").click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(fixture.calls.filter(call => call.name === "projectCreate").length, count);
  // Given a failed create response. When the unchanged form is retried. Then the same idempotency key is preserved.
  fixture.failNext("projectCreate", "TEMPORARILY_UNAVAILABLE");
  await button("Blank project").click();
  await field("Project name").fill("Retry creation");
  await button("Create project").click();
  await waitDom(page, { selector: "dialog", text: "TEMPORARILY_UNAVAILABLE:" });
  const firstKey = fixture.calls.findLast(call => call.name === "projectCreate").input.headers["idempotency-key"];
  await button("Create project").click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(fixture.calls.findLast(call => call.name === "projectCreate").input.headers["idempotency-key"], firstKey);
  return { independentBulkVersions: true, archiveRestore: true, searchSort: true, additiveBulkTags: true, copy: true, confirmedDelete: true, blankSettings: true, templateVersion: true, threeImportErrors: true, conflictPreservesSelection: true, templateCategories: true, tagCrud: true, trashRestore: true, sourceBytes: true, settingsRetryWithoutDuplicate: true, stableCreationRetryKey: true };
}
