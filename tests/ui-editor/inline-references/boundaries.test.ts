import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, waitForRenderedText } from "../shared";
import { fixtureIds } from "../../fixtures/foundation";
import { createProject, responseAfter } from "../tools/helpers";
import { openSurface } from "../assembly/actual-browser";
import { remoteFixture } from "./fixture";

test("occupied noneditable references.bib cannot be overwritten and a Viewer cannot copy a retrieved publication", async () => {
  // Given: a folder occupies the automatic bibliography path.
  await using setup = await remoteFixture();
  await using actor = await authenticatedContext(setup.browser, setup.app);
  const project = await createProject(actor, { name: "P71 occupied path", origin: setup.app.url.origin });
  const current = await actor.context.request.get(`/api/projects/${project.id}/effective-access`, { params: { branch: "main" } });
  const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await current.json()));
  const occupied = await actor.context.request.post(`/api/projects/${project.id}/files`, {
    headers: { origin: setup.app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
    data: { scope: { projectId: project.id, branch: "main" }, path: "references.bib", kind: "folder", expectedVersion: access.branchRevision },
  });
  expect(occupied.status()).toBe(200);
  const page = await actor.context.newPage();
  await openSurface(page, { path: `/projects/${project.id}/edit`, selector: ".qe-main .cm-content" });
  await page.locator(".q-source-references summary").click();
  // When: the user opens the native inline reference controls.
  // Then: remote insertion is visibly disabled without an eligible destination.
  expect(await page.getByLabel("Inline reference provider").isDisabled()).toBe(true);
  expect(setup.requests).toEqual([]);
  const retrieved = await actor.context.request.get("/api/references/search", {
    params: { projectId: fixtureIds.project, provider: "crossref", query: "viewerproof" },
  });
  const publication = editorValue(resultSchema(endpoints.referencesSearch.output).parse(await retrieved.json())).items[0];
  if (!publication) throw new TypeError("Actual provider record required.");
  await using viewer = await authenticatedContext(setup.browser, setup.app, { email: "alex@quire.local" });
  const denied = await viewer.context.request.post(`/api/projects/${fixtureIds.project}/citations`, {
    headers: { origin: setup.app.url.origin, "x-csrf-token": viewer.session.csrfToken, "idempotency-key": crypto.randomUUID() },
    data: { scope: { projectId: fixtureIds.project, branch: "main" }, publication, command: "cite", expectedVersion: 0 },
  });
  expect(denied.status()).toBe(403);
  await Bun.write(`${setup.evidence}/boundaries.json`, JSON.stringify({ occupied: occupied.status(), viewerDenied: denied.status(), requests: setup.requests }, null, 2));
}, 120_000);

test("unconfigured providers return truthful inline errors without invented suggestions", async () => {
  // Given: Crossref alone is configured; Semantic Scholar is not configured.
  await using setup = await remoteFixture();
  await using actor = await authenticatedContext(setup.browser, setup.app);
  const project = await createProject(actor, { name: "P71 missing provider", origin: setup.app.url.origin });
  const page = await actor.context.newPage();
  await openSurface(page, { path: `/projects/${project.id}/edit`, selector: ".qe-main .cm-content" });
  await page.locator(".q-source-references summary").click();
  await page.getByLabel("Inline reference provider").selectOption("semanticScholar");
  await page.getByRole("button", { name: "Done configuring references" }).click();
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+Home");
  // When: citation typing requests the selected unconfigured provider.
  const visible = waitForRenderedText(page, "Choose another provider or ask an administrator");
  const response = await responseAfter(page, { path: "/api/references/search", method: "GET" }, () =>
    page.keyboard.insertText("\\cite{unavailable"));
  // Then: the native service error is visible and there are no fabricated results.
  expect(response.status()).toBe(503);
  await visible;
  expect(await page.locator(".cm-tooltip-autocomplete [role=option]").count()).toBe(0);
  expect(setup.requests).toEqual([]);
  await Bun.write(`${setup.evidence}/unavailable.json`, JSON.stringify({ status: response.status(), response: await response.json() }, null, 2));
}, 120_000);
