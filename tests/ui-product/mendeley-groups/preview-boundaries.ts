import { expect } from "bun:test";
import { endpoints, FileEntrySchema, resultSchema } from "@quire/contracts";
import type { FileEntry, Id } from "@quire/contracts";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import type { startAssemblyApplication } from "../../ui-editor/assembly/application";
import { surfaceSignal } from "../../ui-editor/assembly/actual-browser";
import { authenticateApi, openProjects } from "../../ui-editor/shared";
import { responseAfter } from "../../ui-editor/tools/helpers";
import type { Actor } from "../../ui-editor/tools/helpers";
import type * as Harness from "./preview-harness";

function bounded<T>(promise: Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new TypeError("Preview boundary event was not observed")), 30_000);
    void promise.then(value => { clearTimeout(deadline); resolve(value); }, error => { clearTimeout(deadline); reject(error); });
  });
}

export async function previewBoundaries(input: {
  readonly app: Awaited<ReturnType<typeof startAssemblyApplication>>; readonly actor: Actor;
  readonly page: Page; readonly projectId: Id; readonly groupFile: FileEntry; readonly grantId: Id;
  readonly evidence: string;
}) {
  const { app, actor, page, projectId, groupFile, grantId, evidence } = input;
  const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await (await actor.context.request.get(
    `/api/projects/${projectId}/effective-access`, { params: { branch: "main" } })).json()));
  const personalResponse = await actor.context.request.post(`/api/projects/${projectId}/links`, {
    headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
    data: { scope: { projectId, branch: "main" }, kind: "bibliography", path: "personal-preview.bib",
      grantId, expectedVersion: access.branchRevision },
  });
  expect(personalResponse.status()).toBe(200);
  const personalFile = z.object({ data: FileEntrySchema }).parse(await personalResponse.json()).data;
  if (!personalFile.blob) throw new TypeError("Actual personal linked bibliography required");
  const personalText = new TextDecoder().decode(await app.application.runtime.blobs.get(personalFile.blob));
  await openProjects(page);
  const mounted = await surfaceSignal(page, "main[data-preview-file]");
  await page.evaluate(async values => {
    const path = "/@fs/home/norman/Repos/Quire/tests/ui-product/mendeley-groups/preview-harness.tsx";
    const harness: typeof Harness = await import(path);
    await harness.mountPreview(values.projectId, values.files);
  }, { projectId, files: [groupFile.id, personalFile.id] });
  await mounted.observed;
  const contentPath = `/api/projects/${projectId}/files/${groupFile.id}/content`;
  const handle = app.application.handle;
  type Hold = { started: ReturnType<typeof Promise.withResolvers<void>>;
    release: ReturnType<typeof Promise.withResolvers<void>>; completed: ReturnType<typeof Promise.withResolvers<void>> };
  let hold: Hold | null = null;
  const holds: Hold[] = [];
  const arm = () => {
    const next = { started: Promise.withResolvers<void>(), release: Promise.withResolvers<void>(),
      completed: Promise.withResolvers<void>() };
    hold = next; holds.push(next); return next;
  };
  // Hold only a real, already-authorized native response. Never substitute response bytes/status.
  app.application.handle = async (request, server) => {
    const response = await handle(request, server);
    if (new URL(request.url).pathname === contentPath && hold) {
      const current = hold; hold = null;
      current.started.resolve();
      await current.release.promise;
      current.completed.resolve();
    }
    return response;
  };
  try {
    await page.getByLabel("Preview selected file", { exact: true }).selectOption(groupFile.id);
    const fileHold = arm();
    await page.getByRole("button", { name: "Open selected linked bibliography", exact: true }).click();
    await bounded(fileHold.started.promise);
    const abortedFile = page.waitForEvent("requestfailed", {
      predicate: request => new URL(request.url()).pathname === contentPath, timeout: 30_000,
    });
    const selectedPersonal = await surfaceSignal(page, `main[data-preview-file="${personalFile.id}"]`);
    await page.getByLabel("Preview selected file", { exact: true }).selectOption(personalFile.id);
    await selectedPersonal.observed; await abortedFile;
    fileHold.release.resolve(); await bounded(fileHold.completed.promise);
    expect(await page.locator("pre").count()).toBe(0);
    const visiblePersonal = await surfaceSignal(page, `section[aria-label="Read-only bibliography: personal-preview.bib"] pre`);
    await page.getByRole("button", { name: "Open selected linked bibliography", exact: true }).click();
    await visiblePersonal.observed;
    expect(await page.locator("pre").innerText()).toBe(personalText);
    expect(await page.getByRole("region", { name: "Read-only bibliography: personal-preview.bib", exact: true })
      .locator("[contenteditable=true],input,textarea,select").count()).toBe(0);
    await page.getByLabel("Preview selected file", { exact: true }).selectOption(groupFile.id);
    const actorHold = arm();
    await page.getByRole("button", { name: "Open selected linked bibliography", exact: true }).click();
    await bounded(actorHold.started.promise);
    const outsider = await authenticateApi(app, "outsider@quire.local");
    await actor.context.addCookies([outsider.cookie]);
    const abortedActor = page.waitForEvent("requestfailed", {
      predicate: request => new URL(request.url()).pathname === contentPath, timeout: 30_000,
    });
    const changedActor = await surfaceSignal(page, `main[data-preview-actor="${outsider.user.id}"]`);
    await page.getByRole("button", { name: "Refresh preview actor", exact: true }).click();
    await changedActor.observed; await abortedActor;
    actorHold.release.resolve(); await bounded(actorHold.completed.promise);
    expect(await page.locator("pre").count()).toBe(0);
    const deniedAlert = await surfaceSignal(page, '[role="alert"]');
    const denied = await responseAfter(page, { path: `/api/projects/${projectId}/effective-access`, method: "GET" }, () =>
      page.getByRole("button", { name: "Open selected linked bibliography", exact: true }).click());
    // Project reads deliberately mask an unauthorized project as not found.
    expect(denied.status()).toBe(404);
    await deniedAlert.observed;
    expect((await page.getByRole("alert").innerText()).length).toBeGreaterThan(0);
    expect(await page.locator("pre").count()).toBe(0);
    await page.screenshot({ path: `${evidence}/preview-access-denied.png`, fullPage: true });
    await Bun.write(`${evidence}/preview-boundaries.json`, JSON.stringify({
      projectId, groupFile: groupFile.id, personalFile: personalFile.id, outsider: outsider.user.id,
      staleFileRequestAborted: true, staleActorRequestAborted: true, actualPersonalBytes: personalText,
      deniedStatus: denied.status(), deniedAlert: await page.getByRole("alert").innerText(),
      previewMutationControls: 0,
    }, null, 2));
  } finally {
    app.application.handle = handle;
    for (const current of holds) current.release.resolve();
    await bounded(page.evaluate(() => new Promise<void>(resolve => {
      window.addEventListener("p50:preview-disposed", () => resolve(), { once: true });
      window.dispatchEvent(new Event("p50:preview-dispose"));
    })));
  }
}
