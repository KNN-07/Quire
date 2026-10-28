import { expect, test } from "bun:test";
import { join } from "node:path";
import { nextApplicationEvent, authenticatedContext, startEditorApplication, startEditorBrowser } from "../shared";
import { firstProject, gitCli, mountGit, prepareTwoHunks, projectService } from "./setup";

test("T12 drives hunk staging, commit, rendered comparison, branch creation and real clone", async () => {
  // Given: real services, an authenticated owner, and two separated durable browser edits.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using actor = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
  const project = await firstProject(actor.context);
  const prepared = await prepareTwoHunks(app, actor, project);
  const page = await actor.context.newPage();
  await mountGit(page, project.id);
  expect(await page.locator(".git-hunk").count()).toBe(2);

  // When: the first real hunk is staged and committed from the screen.
  const stageResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/git/stage") && response.request().method() === "PUT");
  await page.locator(".git-hunk").first().getByRole("button", { name: "Stage hunk" }).click();
  const staged = await stageResponse;
  if (staged.status() !== 200) throw new TypeError(`Browser stage failed: ${await staged.text()}`);
  await page.getByLabel("Commit message").fill("Browser hunk commit");
  using committed = nextApplicationEvent(app, event =>
    event.topic === "operation.changed" && event.payload.status === "succeeded");
  const commitResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/git/commit") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Commit 1 hunk" }).click();
  expect((await commitResponse).status()).toBe(202);
  expect((await committed.promise).topic).toBe("operation.changed");

  // Then: named Git contains only the staged bytes and live browser source retains both edits.
  const named = new TextDecoder().decode(await app.application.runtime.repositories.read(
    project.id, ["show", "main:main.tex"],
  ));
  expect(named).toContain("First browser edit.");
  expect(named).toContain("Line 22.");
  expect((await projectService(app).readDocument(prepared.scope, project.settings.mainFileId)).text)
    .toBe(prepared.changed);

  // When: the remaining working bytes are rendered against the exact named HEAD.
  await page.getByRole("button", { name: "Rendered PDF" }).click();
  using rendered = nextApplicationEvent(app, event =>
    event.topic === "operation.changed" && event.aggregateId === project.id
      && event.payload.status === "succeeded", 120_000);
  const compareResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/pdf-diffs") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Render comparison" }).click();
  expect((await compareResponse).status()).toBe(202);
  await rendered.promise;
  const operationResponse = page.waitForResponse(response =>
    /\/api\/operations\/[^/]+$/.test(new URL(response.url()).pathname));
  const artifactResponse = page.waitForResponse(response =>
    /\/api\/artifacts\/[^/]+\/content$/.test(new URL(response.url()).pathname));
  await page.getByRole("button", { name: "Check result" }).click();
  expect((await operationResponse).status()).toBe(200);
  expect((await artifactResponse).status()).toBe(200);
  await page.getByAltText("Rendered PDF comparison preview").waitFor({ state: "visible" });
  expect(await page.getByAltText("Rendered PDF comparison preview").count()).toBe(1);

  // When: the owner creates and opens a named branch through the modal.
  await page.getByRole("button", { name: "New branch" }).click();
  await page.getByLabel("Branch name").fill("browser/topic");
  const branchResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/git/branches") && response.request().method() === "POST");
  const openedBranch = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/git/status") && url.searchParams.get("branch") === "browser/topic";
  });
  await page.getByRole("button", { name: "Create branch" }).click();
  expect((await branchResponse).status()).toBe(200);
  expect((await openedBranch).status()).toBe(200);
  expect(await page.getByLabel("Branch", { exact: true }).inputValue()).toBe("browser/topic");

  // When: the screen creates one-time credentials and a real Git CLI uses the shown clone URL.
  await page.getByRole("button", { name: "Create access token" }).click();
  const tokenResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/me/git-tokens" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create token" }).click();
  expect((await tokenResponse).status()).toBe(200);
  const secret = await page.getByLabel("New Git token").textContent();
  const cloneValue = await page.getByLabel("HTTPS clone URL").inputValue();
  if (!secret) throw new TypeError("One-time Git token missing");
  const url = new URL(cloneValue);
  url.username = "git";
  url.password = secret;
  const checkout = join(app.dataDir, "ui-git-clone");
  const cloned = await gitCli(["clone", url.toString(), checkout], app.dataDir);
  expect(cloned.code, JSON.stringify(cloned)).toBe(0);
  expect((await gitCli(["-C", checkout, "branch", "--show-current"], app.dataDir)).out.trim()).toBe("main");
}, 240_000);
