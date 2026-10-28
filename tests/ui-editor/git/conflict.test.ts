import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, nextApplicationEvent, startEditorApplication, startEditorBrowser } from "../shared";
import { firstProject, mountGit, projectService } from "./setup";
import { GitRepository } from "../../../services/core/git";
import { objects, raw } from "../../../services/core/git/process";

test("T12 exposes structured conflicts and completes a version-fenced browser resolution", async () => {
  // Given: two named branches with a real same-line content conflict.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using actor = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
  const project = await firstProject(actor.context);
  const scope = { projectId: project.id, branch: "main" };
  const service = projectService(app);
  const repo = new GitRepository(service);
  const initialized = await actor.context.request.get(`/api/projects/${project.id}/git/status?branch=main`);
  const head = editorValue(resultSchema(endpoints.gitStatus.output).parse(await initialized.json())).head;
  const source = (await service.readDocument(scope, project.settings.mainFileId)).text;
  const commits = await Promise.all(["Current branch", "Other branch"].map(async marker => {
    const blob = (await objects(service, scope, ["hash-object", "-w", "--stdin"],
      new TextEncoder().encode(source.replace("\\begin{document}", `\\begin{document}\n${marker}`)))).text;
    const tree = (await objects(service, scope, ["mktree"],
      new TextEncoder().encode(`100644 blob ${blob}\tmain.tex\n`))).text;
    return repo.commitTree(actor.session.user.id, {
      scope, tree, parents: [raw(head)], message: marker,
    });
  }));
  const ours = commits[0], theirs = commits[1];
  if (!ours || !theirs) throw new TypeError("Conflict commits missing");
  await service.serialized(scope, lease => service.serialized({ ...scope, branch: "other" }, otherLease =>
    repo.journal.publish(actor.session.user.id, [
      { scope, before: raw(head), after: ours, hydrate: true },
      { scope: { ...scope, branch: "other" }, before: "0".repeat(40), after: theirs, hydrate: true },
    ], [lease, otherLease])));
  const page = await actor.context.newPage();
  await mountGit(page, project.id);

  // When: the owner requests the merge and edits the structured resolution.
  await page.locator(".git-merge select").selectOption("other");
  const mergeResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/git/merge") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Merge into main" }).click();
  expect((await mergeResponse).status()).toBe(202);
  await page.getByText("Resolve every conflicted file before completing the merge.").waitFor({ state: "visible" });
  expect(await page.getByRole("heading", { name: "Resolve merge conflicts" }).count()).toBe(1);
  const resolvedText = source.replace("\\begin{document}", "\\begin{document}\nBrowser resolved");
  await page.getByLabel("Resolved source").fill(resolvedText);
  const complete = page.getByTestId("git-complete-merge");
  expect(await complete.isEnabled()).toBe(true);
  using completed = nextApplicationEvent(app, event =>
    event.topic === "operation.changed" && event.payload.status === "succeeded");
  const resolveResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname.includes("/git/conflicts/") && response.request().method() === "POST");
  await complete.click();
  expect((await resolveResponse).status()).toBe(202);
  expect((await completed.promise).topic).toBe("operation.changed");

  // Then: both named parents and durable browser source contain the explicit resolution.
  expect((await service.readDocument(scope, project.settings.mainFileId)).text).toBe(resolvedText);
  const parents = (await objects(service, scope, ["log", "--format=%P", "-1", "main"])).text.split(" ");
  expect(parents).toHaveLength(2);
}, 180_000);
