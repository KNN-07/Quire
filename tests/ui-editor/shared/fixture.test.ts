import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { endpoints, resultSchema } from "@quire/contracts";
import { defaultPolicy, fixtureIds } from "../../fixtures/foundation";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import {
  authenticatedContext, nextApplicationEvent, openProjects, projectDocument,
  startEditorApplication, startEditorBrowser, waitForRenderedText,
} from "./index";
import type { EditorApplication, EditorBrowser } from "./index";
import type * as Shared from "../../../apps/web/src/features/editor/shared";
import type * as Sessions from "../../../apps/web/src/session";
import type * as Contracts from "@quire/contracts";

describe("real editor fixture", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  beforeAll(async () => {
    try {
      app = resources.use(await startEditorApplication());
      browser = resources.use(await startEditorBrowser());
    } catch (error) {
      await resources.disposeAsync();
      throw error;
    }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    console.info("EDITOR_FIXTURE_CLOSED", { api: app?.apiUrl.origin, web: app?.url.origin, root: app?.dataDir });
  }, 30_000);

  test.each([1440, 390])("renders authorized real project data at width %i", async width => {
    // Given the actual app, seeded SQL/blob/Git stores and a real authenticated browser.
    await using actor = await authenticatedContext(browser, app, { viewport: { width, height: width === 390 ? 844 : 900 } });
    const page = await actor.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    // When the browser navigates through the actual session router.
    const projects = await openProjects(page);
    const project = projects.items.find(item => item.id === fixtureIds.project);
    if (!project) throw new TypeError("Seed project missing from authorized HTTP response");
    await waitForRenderedText(page, project.name);
    // Then the visible product and persisted source match real authorized data.
    const document = await projectDocument(actor.context, {
      projectId: project.id, fileId: project.settings.mainFileId, branch: project.defaultBranch,
    });
    expect(await page.getByRole("button", { name: project.name, exact: true }).count()).toBe(1);
    expect(document.file.id).toBe(fixtureIds.mainFile);
    expect(document.text).toContain("\\documentclass");
    expect(errors).toEqual([]);
    await page.screenshot({
      path: fileURLToPath(new URL(`./evidence/projects-${width}.png`, import.meta.url)), fullPage: true,
    });
    console.info("EDITOR_FIXTURE_BROWSER", { width, projectId: project.id, fileId: document.file.id, bytes: document.file.bytes });
  }, 60_000);

  test("loads the shared workspace through the injected browser session client", async () => {
    // Given a signed-in browser using Vite-served production modules.
    await using actor = await authenticatedContext(browser, app);
    const page = await actor.context.newPage();
    await openProjects(page);
    const branch = await app.application.runtime.db.get<{ revision: number }>(
      "SELECT revision FROM branch_workspaces WHERE project_id=? AND branch='main'", [fixtureIds.project],
    );
    if (!branch) throw new TypeError("Seed branch missing");
    // When the real shared loader is called with the session-owned client.
    const workspace = await page.evaluate(async projectId => {
      const sharedPath = "/src/features/editor/shared/index.ts";
      const sessionPath = "/src/session.ts";
      const shared: typeof Shared = await import(sharedPath);
      const sessions: typeof Sessions = await import(sessionPath);
      const session = sessions.createSession();
      await session.refresh();
      const route = shared.parseEditorRoute(`/projects/${projectId}/edit`);
      if (!route) throw new TypeError("Invalid seeded project route");
      return shared.loadEditorWorkspace(session.client, route);
    }, fixtureIds.project);
    // Then authority and branch revision come from the actual endpoint.
    expect(workspace.access.role).toBe("owner");
    expect(workspace.access.capabilities.edit).toBe(true);
    expect(workspace.access.branchRevision).toBe(branch.revision);
    expect(workspace.files.some(file => file.id === fixtureIds.mainFile)).toBe(true);
  }, 60_000);

  test("observes a real mutation through a pre-registered exact event", async () => {
    // Given an owner and a subscribed tree event before the request.
    await using actor = await authenticatedContext(browser, app);
    const scope = { projectId: fixtureIds.project, branch: "main" };
    const response = await actor.context.request.get(`/api/projects/${scope.projectId}/effective-access`, { params: { branch: scope.branch } });
    const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await response.json()));
    using changed = nextApplicationEvent(app, event => event.topic === "tree.changed" && event.aggregateId === scope.projectId);
    // When a real source file is created through HTTP.
    const [created, event] = await Promise.all([
      actor.context.request.post(`/api/projects/${scope.projectId}/files`, {
        headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
        data: { scope, path: "fixture-proof.tex", kind: "file", text: "Fixture proof", expectedVersion: access.branchRevision },
      }),
      changed.promise,
    ]);
    // Then the server event and persisted document describe that committed mutation.
    const file = editorValue(resultSchema(endpoints.fileCreate.output).parse(await created.json()));
    const document = await projectDocument(actor.context, { ...scope, fileId: file.id });
    expect(event.topic).toBe("tree.changed");
    expect(document.text).toBe("Fixture proof");
  }, 60_000);

  test("denies an outsider the same project data", async () => {
    // Given an authenticated outsider in an independent cookie context.
    await using actor = await authenticatedContext(browser, app, { email: "outsider@quire.local" });
    // When the same effective-access API is requested.
    const response = await actor.context.request.get(`/api/projects/${fixtureIds.project}/effective-access`, { params: { branch: "main" } });
    const result = resultSchema(endpoints.projectAccess.output).parse(await response.json());
    // Then the real server rejects access instead of supplying fixture success.
    expect(response.status()).toBe(404);
    expect("error" in result && result.error.code).toBe("NOT_FOUND");
  }, 30_000);

  test("retains scoped credentials for a token-only panel document request", async () => {
    // Given an actual Viewer share and a browser without any session cookie.
    await using owner = await authenticatedContext(browser, app);
    const policy = JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: true });
    await app.application.runtime.db.run("UPDATE organizations SET policy_json=?", [policy]);
    await app.application.runtime.db.run(
      "INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)",
      [crypto.randomUUID(), fixtureIds.project, policy, app.application.runtime.clock.now()],
    );
    const projectResponse = await owner.context.request.get(`/api/projects/${fixtureIds.project}`, { params: { branch: "main" } });
    const project = editorValue(resultSchema(endpoints.projectGet.output).parse(await projectResponse.json()));
    const shareResponse = await owner.context.request.put(`/api/projects/${project.id}/link`, {
      headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken,
        "idempotency-key": crypto.randomUUID(), "if-match": `"v${project.version}"` },
      data: { role: "viewer", expectedVersion: project.version },
    });
    const share = editorValue(resultSchema(endpoints.accessLinkPut.output).parse(await shareResponse.json()));
    if (!share.urlOnce) throw new TypeError("Real share URL missing");
    const context = await browser.browser.newContext({ baseURL: app.url.origin });
    try {
      const page = await context.newPage();
      await page.goto("/", { waitUntil: "domcontentloaded" });
      // When a panel uses the shared loader's returned credential context.
      const result = await page.evaluate(async shareUrl => {
        const sharedPath = "/src/features/editor/shared/index.ts";
        const sessionPath = "/src/session.ts";
        const contractsPath = "/@fs" + shareUrl.contractsPath;
        const shared: typeof Shared = await import(sharedPath);
        const sessions: typeof Sessions = await import(sessionPath);
        const contracts: typeof Contracts = await import(contractsPath);
        const route = shared.parseEditorRoute(shareUrl.url);
        if (!route) throw new TypeError("Invalid real share route");
        const session = sessions.createSession();
        const workspace = await shared.loadEditorWorkspace(session.client, route);
        const document = shared.editorValue(await session.client.call(contracts.endpoints.fileDocument, {
          params: { p: workspace.project.id, f: workspace.project.settings.mainFileId },
          query: { branch: workspace.scope.branch }, body: undefined, headers: workspace.requestHeaders,
        }));
        return { access: workspace.access, fileId: document.file.id };
      }, { url: share.urlOnce, contractsPath: fileURLToPath(new URL("../../../packages/contracts/src/index.ts", import.meta.url)) });
      // Then a subsequent request is authorized without inventing membership.
      expect(result.access.actorId).toBeNull();
      expect(result.access.capabilities.edit).toBe(false);
      expect(result.fileId).toBe(fixtureIds.mainFile);
    } finally {
      await context.close();
      await app.application.runtime.db.run("DELETE FROM policy_sets WHERE scope_kind='project' AND scope_id=?", [fixtureIds.project]);
      await app.application.runtime.db.run("UPDATE organizations SET policy_json=?", [JSON.stringify(defaultPolicy)]);
    }
  }, 60_000);
});
