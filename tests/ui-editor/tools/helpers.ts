import { endpoints, resultSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import type { Page, Request, Response } from "@playwright/test";
import type { authenticatedContext } from "../shared";
import { openProjects, waitForRenderedText } from "../shared";
import type * as Harness from "./browser-harness";
import type { FilesPanelProps } from "../../../apps/web/src/features/editor/tools";

export type Actor = Awaited<ReturnType<typeof authenticatedContext>>;
export async function toolScenario(action: () => Promise<void>): Promise<void> {
  try { await action(); }
  catch (error) {
    if (error instanceof SuppressedError) console.error("TOOLS_SUPPRESSED_FAILURE", error.error, error.suppressed);
    throw error;
  }
}
export async function mount(page: Page, projectId: string, filesPresentation: NonNullable<FilesPanelProps["presentation"]> = "standalone") {
  const failed = (request: Request) => console.error("TOOLS_MOUNT_REQUEST_FAILED", new URL(request.url()).pathname, request.failure()?.errorText);
  const response = (value: Response) => {
    if (value.status() >= 400) console.error("TOOLS_MOUNT_HTTP_ERROR", new URL(value.url()).pathname, value.status());
  };
  page.on("requestfailed", failed); page.on("response", response);
  try {
    await openProjects(page);
    await page.evaluate(async ({ id, presentation }) => {
      const path = "/@fs/home/norman/Repos/Quire/tests/ui-editor/tools/browser-harness.tsx";
      const harness: typeof Harness = await import(path);
      await harness.mountTools(id, presentation);
    }, { id: projectId, presentation: filesPresentation });
    await waitForRenderedText(page, filesPresentation === "compact" ? "File actions" : "New folder");
  } finally {
    page.off("requestfailed", failed); page.off("response", response);
  }
}

export async function responseAfter(page: Page, target: { readonly path: string; readonly method: string }, action: () => Promise<unknown>): Promise<Response> {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === target.path && value.request().method() === target.method, { timeout: 30_000 });
  const [result] = await Promise.all([response, action()]);
  return result;
}

export async function createProject(actor: Actor, input: { readonly name: string; readonly origin: string }) {
  const response = await actor.context.request.post("/api/projects", {
    headers: { origin: input.origin, "idempotency-key": crypto.randomUUID(), "x-csrf-token": actor.session.csrfToken },
    data: { name: input.name, origin: { kind: "blank" } },
  });
  return editorValue(resultSchema(endpoints.projectCreate.output).parse(await response.json()));
}

export async function createInputFile(actor: Actor, input: {
  readonly projectId: Id; readonly origin: string; readonly path: string; readonly text: string;
}) {
  const scope = { projectId: input.projectId, branch: "main" };
  const current = await actor.context.request.get(`/api/projects/${scope.projectId}/effective-access`, { params: { branch: scope.branch } });
  const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await current.json()));
  const response = await actor.context.request.post(`/api/projects/${scope.projectId}/files`, {
    headers: { origin: input.origin, "idempotency-key": crypto.randomUUID(), "x-csrf-token": actor.session.csrfToken },
    data: { scope, path: input.path, kind: "file", text: input.text, expectedVersion: access.branchRevision },
  });
  return editorValue(resultSchema(endpoints.fileCreate.output).parse(await response.json()));
}

export async function disposePage(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new TypeError("Tool harness cleanup exceeded 30 seconds.")), 30_000);
    window.addEventListener("tools:disposed", () => { clearTimeout(timeout); resolve(); }, { once: true });
    window.dispatchEvent(new Event("tools:dispose"));
  }));
}

export async function waitForDocument(page: Page, id: string) {
  await page.evaluate(expected => new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(check);
    const timeout = setTimeout(() => { observer.disconnect(); reject(new TypeError("Document did not reach saved state.")); }, 30_000);
    function check() {
      const main = document.querySelector(".tools-harness");
      if (main?.getAttribute("data-document-id") !== expected || main.getAttribute("data-persistence") !== "saved") return;
      observer.disconnect(); clearTimeout(timeout); resolve();
    }
    observer.observe(document.body, { subtree: true, attributes: true, childList: true });
    check();
  }), id);
}
