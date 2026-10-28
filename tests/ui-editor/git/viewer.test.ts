import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, startEditorApplication, startEditorBrowser } from "../shared";
import { firstProject, mountGit, prepareTwoHunks } from "./setup";

test("T12 renders Viewer denial and the real endpoint rejects the same staged write", async () => {
  // Given: an owner creates actual browser changes and a separate Viewer opens Git.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using owner = await authenticatedContext(browser, app);
  const project = await firstProject(owner.context);
  await prepareTwoHunks(app, owner, project);
  await using viewer = await authenticatedContext(browser, app, {
    email: "alex@quire.local", viewport: { width: 1440, height: 900 },
  });
  const page = await viewer.context.newPage();
  await mountGit(page, project.id);

  // When: the Viewer inspects a real changed hunk.
  expect(await page.getByText("Viewer access: Git writes are disabled.").count()).toBe(1);
  const stage = page.getByRole("button", { name: "Stage hunk" }).first();
  expect(await stage.isDisabled()).toBe(true);
  const statusResponse = await viewer.context.request.get(`/api/projects/${project.id}/git/status?branch=main`);
  const status = editorValue(resultSchema(endpoints.gitStatus.output).parse(await statusResponse.json()));
  const version = Number(statusResponse.headers()["etag"]?.replace(/\D/g, ""));

  // Then: bypassing the disabled control still reaches server-enforced denial.
  const denied = await viewer.context.request.put(`/api/projects/${project.id}/git/stage`, {
    headers: {
      origin: app.url.origin,
      "x-csrf-token": viewer.session.csrfToken,
      "if-match": `"v${version}"`,
    },
    data: {
      scope: { projectId: project.id, branch: "main" }, head: status.head,
      hunkIds: status.hunks.slice(0, 1).map(hunk => hunk.id), staged: true,
      expectedVersion: version,
    },
  });
  expect(denied.status()).toBe(403);
}, 180_000);
