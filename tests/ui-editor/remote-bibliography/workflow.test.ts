import { expect, test } from "bun:test";
import { DigestSchema, endpoints, resultSchema } from "@quire/contracts";
import type { Publication } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { bibliographyKeys } from "../../../apps/web/src/features/editor/tools/insertion";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticatedContext, projectDocument, waitForRenderedText } from "../shared";
import { createInputFile, createProject, responseAfter } from "../tools/helpers";
import { bibliography, capture, remoteFixture } from "./fixture";

test("native remote search selects metadata and copies/cites exact returned BibTeX into the chosen editable target", async () => {
  await using setup = await remoteFixture();
  await using actor = await authenticatedContext(setup.browser, setup.app, { viewport: { width: 1440, height: 900 } });
  const page = await actor.context.newPage();
  page.on("pageerror", error => setup.errors.push(error.stack ?? error.message));
  const project = await createProject(actor, { name: "P29 remote bibliography", origin: setup.app.url.origin });
  const scope = { projectId: project.id, branch: "main", fileId: project.settings.mainFileId };
  const first = await createInputFile(actor, { projectId: project.id, origin: setup.app.url.origin, path: "first.bib", text: "" });
  const target = await createInputFile(actor, { projectId: project.id, origin: setup.app.url.origin, path: "selected.bib", text: "" });
  const before = await projectDocument(actor.context, scope);
  await bibliography(page, project.id);
  const remote = page.getByRole("region", { name: "Remote references", exact: true });
  expect(setup.requests).toEqual([]);
  await page.getByLabel("Remote reference query", { exact: true }).fill("copyproof");
  expect(setup.requests).toEqual([]);
  const searched = await responseAfter(page, { path: "/api/references/search", method: "GET" }, () =>
    remote.getByRole("button", { name: "Search provider", exact: true }).click());
  const result = editorValue(resultSchema(endpoints.referencesSearch.output).parse(await searched.json()));
  const publication = result.items[0];
  if (!publication) throw new TypeError("Actual retrieved publication required");
  await waitForRenderedText(page, publication.title);
  expect(await remote.innerText()).toContain("Grace Hopper; Ada Lovelace");
  expect(await remote.innerText()).toContain("2026");
  expect(await remote.innerText()).toContain("Source: crossref · 10.1234/copyproof");
  expect(await remote.innerText()).toContain("DOI: 10.1234/copyproof");
  await remote.getByRole("radio", { name: publication.title, exact: true }).check();
  expect(await remote.getByRole("button", { name: "Copy remote to project", exact: true }).isDisabled()).toBe(true);
  await page.getByLabel("Bibliography target", { exact: true }).selectOption(target.id);
  await capture(setup, page, { query: "copyproof", title: publication.title, target: target.id });
  const copied = await responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" }, () =>
    remote.getByRole("button", { name: "Copy remote to project", exact: true }).click());
  expect(copied.status()).toBe(200);
  const copiedFile = editorValue(resultSchema(endpoints.citationCreate.output).parse(await copied.json()));
  expect(copiedFile.id).toBe(target.id);
  expect((await projectDocument(actor.context, { ...scope, fileId: target.id })).text).toBe(publication.bibtex + "\n");
  expect((await projectDocument(actor.context, { ...scope, fileId: first.id })).text).toBe("");
  expect((await projectDocument(actor.context, scope)).text).toBe(before.text);
  await waitForRenderedText(page, "Copied");
  // A second real result is cited so an existing entry cannot mask a failed copy.
  await page.getByLabel("Remote reference query", { exact: true }).fill("citeproof");
  const citingSearch = await responseAfter(page, { path: "/api/references/search", method: "GET" }, () =>
    remote.getByRole("button", { name: "Search provider", exact: true }).click());
  const cited = editorValue(resultSchema(endpoints.referencesSearch.output).parse(await citingSearch.json())).items[0];
  if (!cited) throw new TypeError("Actual citation publication required");
  await waitForRenderedText(page, cited.title);
  await remote.getByRole("radio", { name: cited.title, exact: true }).check();
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+Home");
  const key = bibliographyKeys(cited.bibtex)[0]?.key;
  if (!key) throw new TypeError("Returned BibTeX citation key required");
  const inserted = await responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" }, () =>
    remote.getByRole("button", { name: "Cite remote in project", exact: true }).click());
  expect(inserted.status()).toBe(200);
  await waitForRenderedText(page, `Inserted citation ${key}`);
  const after = await projectDocument(actor.context, scope);
  expect(after.text).toBe(`\\cite{${key}}` + before.text);
  expect((await projectDocument(actor.context, { ...scope, fileId: target.id })).text).toBe(`${publication.bibtex}\n${cited.bibtex}\n`);
  await bibliography(page, project.id);
  expect((await projectDocument(actor.context, scope)).text).toBe(after.text);
  expect(await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).innerText()).toContain(`\\cite{${key}}`);
  const retained = await setup.app.application.runtime.db.all<{ publication_json: string; response_digest: string; endpoint: string; provider: string; provider_id: string }>(
    "SELECT publication_json,response_digest,endpoint,provider,provider_id FROM reference_provenance WHERE owner_id=? ORDER BY provider_id", [fixtureIds.kien]);
  expect(retained).toHaveLength(2);
  for (const row of retained) {
    const actual: Publication = JSON.parse(row.publication_json);
    expect([publication, cited]).toContainEqual(actual);
    expect(row.provider).toBe(actual.provider); expect(row.provider_id).toBe(actual.providerId);
    const raw = await setup.app.application.runtime.blobs.get(DigestSchema.parse(row.response_digest));
    expect(JSON.parse(new TextDecoder().decode(raw)).message.items[0].DOI).toBe(actual.doi);
    expect(new URL(row.endpoint).searchParams.get("query.bibliographic")).toBe(actual.doi?.split("/")[1] ?? "");
  }
  const otherProject = await createProject(actor, { name: "P29 switched project", origin: setup.app.url.origin });
  const held = setup.hold("projectswitch");
  await page.getByLabel("Remote reference query", { exact: true }).fill("projectswitch");
  await remote.getByRole("button", { name: "Search provider", exact: true }).click();
  await held.started;
  await bibliography(page, otherProject.id);
  held.release(); await held.completed;
  expect(await remote.getByRole("radio").count()).toBe(0);
  expect(await page.getByLabel("Remote reference query", { exact: true }).inputValue()).toBe("");
  await Bun.write(`${setup.evidence}/workflow.json`, JSON.stringify({ project: project.id, target: target.id,
    untouched: first.id, publications: [publication, cited], key, before: before.text, after: after.text, retained,
    switchedProject: otherProject.id, projectSwitchDiscarded: true, requests: setup.requests }, null, 2));
  expect(setup.errors).toEqual([]);
}, 180_000);

test("Viewer search is readable but project writes are denied, unconfigured providers report real errors, and old results are discarded", async () => {
  await using setup = await remoteFixture();
  await using actor = await authenticatedContext(setup.browser, setup.app, { email: "alex@quire.local", viewport: { width: 1440, height: 900 } });
  const page = await actor.context.newPage();
  page.on("pageerror", error => setup.errors.push(error.stack ?? error.message));
  await bibliography(page, fixtureIds.project);
  const remote = page.getByRole("region", { name: "Remote references", exact: true });
  await page.getByLabel("Remote reference query", { exact: true }).fill("viewer");
  const search = await responseAfter(page, { path: "/api/references/search", method: "GET" }, () =>
    remote.getByRole("button", { name: "Search provider", exact: true }).click());
  const publication = editorValue(resultSchema(endpoints.referencesSearch.output).parse(await search.json())).items[0];
  if (!publication) throw new TypeError("Viewer retrieved record required");
  await waitForRenderedText(page, publication.title);
  await remote.getByRole("radio", { name: publication.title, exact: true }).check();
  expect(await remote.getByRole("button", { name: "Copy remote to project", exact: true }).isDisabled()).toBe(true);
  expect(await remote.getByRole("button", { name: "Cite remote in project", exact: true }).isDisabled()).toBe(true);
  const denied = await actor.context.request.post(`/api/projects/${fixtureIds.project}/citations`, {
    headers: { origin: setup.app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
    data: { scope: { projectId: fixtureIds.project, branch: "main" }, publication, command: "cite", expectedVersion: 0 },
  });
  expect(denied.status()).toBe(403);
  await page.getByLabel("Reference provider", { exact: true }).selectOption("semanticScholar");
  const unavailable = await responseAfter(page, { path: "/api/references/search", method: "GET" }, () =>
    remote.getByRole("button", { name: "Search provider", exact: true }).click());
  expect(unavailable.status()).toBe(503);
  await waitForRenderedText(page, "Missing: operator semanticScholar base URL configuration");
  expect(await remote.getByRole("radio").count()).toBe(0);
  expect(await page.getByLabel("Reference provider", { exact: true }).locator('option[value="dimensions"]').getAttribute("disabled")).toBe("");
  await page.getByLabel("Reference provider", { exact: true }).selectOption("crossref");
  await page.getByLabel("Remote reference query", { exact: true }).fill("delayed");
  const held = setup.hold("delayed");
  await remote.getByRole("button", { name: "Search provider", exact: true }).click();
  await held.started;
  const canceled = page.waitForEvent("requestfailed", { predicate: request =>
    new URL(request.url()).pathname === "/api/references/search" && new URL(request.url()).searchParams.get("query") === "delayed" });
  await page.getByLabel("Remote reference query", { exact: true }).fill("latest");
  await canceled;
  const latest = await responseAfter(page, { path: "/api/references/search", method: "GET" }, () =>
    remote.getByRole("button", { name: "Search provider", exact: true }).click());
  expect(latest.status()).toBe(200);
  await waitForRenderedText(page, "Research latest");
  held.release();
  await held.completed;
  expect(await remote.getByRole("radio").count()).toBe(1);
  expect(await remote.innerText()).toContain("Research latest");
  expect(await remote.innerText()).not.toContain("Research delayed");
  const providerHeld = setup.hold("providerchange");
  await page.getByLabel("Remote reference query", { exact: true }).fill("providerchange");
  await remote.getByRole("button", { name: "Search provider", exact: true }).click();
  await providerHeld.started;
  await page.getByLabel("Reference provider", { exact: true }).selectOption("arxiv");
  providerHeld.release(); await providerHeld.completed;
  expect(await remote.getByRole("radio").count()).toBe(0);
  const projectHeld = setup.hold("projectchange");
  await page.getByLabel("Reference provider", { exact: true }).selectOption("crossref");
  await page.getByLabel("Remote reference query", { exact: true }).fill("projectchange");
  await remote.getByRole("button", { name: "Search provider", exact: true }).click();
  await projectHeld.started;
  await page.goto("/projects", { waitUntil: "domcontentloaded" });
  projectHeld.release(); await projectHeld.completed;
  await bibliography(page, fixtureIds.project);
  expect(await remote.getByRole("radio").count()).toBe(0);
  expect(await page.getByLabel("Remote reference query", { exact: true }).inputValue()).toBe("");
  await Bun.write(`${setup.evidence}/boundaries.json`, JSON.stringify({ denied: denied.status(), unavailable: unavailable.status(),
    queryCancellation: true, latestOnly: true, providerCancellation: true, projectUnmountCancellation: true, requests: setup.requests }, null, 2));
  expect(setup.errors).toEqual([]);
}, 180_000);
