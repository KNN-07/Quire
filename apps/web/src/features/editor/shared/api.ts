import { BranchSchema, IdSchema, endpoints } from "@quire/contracts";
import type { Result, Scope } from "@quire/contracts";
import type { EditorClient, EditorWorkspace } from "./contracts";

export class EditorApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "EditorApiError";
  }
}
export function editorValue<T>(result: Result<T>): T {
  if ("error" in result) throw new EditorApiError(result.error.code, result.error.message);
  return result.data;
}
export type EditorRoute = {
  readonly projectId: Scope["projectId"];
  readonly branch: Scope["branch"] | null;
  readonly page: "edit" | "git" | "agent" | "history" | "review" | "logs" | "pdf-diff";
  readonly shareToken: string | null;
};
export function parseEditorRoute(path: string): EditorRoute | null {
  const url = new URL(path, "http://quire.local");
  const match = /^\/projects\/([^/]+)\/(edit|git|agent|history|review|logs|pdf-diff)\/?$/.exec(url.pathname);
  if (!match) return null;
  const project = IdSchema.safeParse(match[1]);
  const page = match[2];
  if (!project.success) return null;
  const rawBranch = url.searchParams.get("branch");
  const branch = rawBranch === null ? null : BranchSchema.safeParse(rawBranch);
  if (branch !== null && !branch.success) return null;
  switch (page) {
    case "edit": case "git": case "agent": case "history": case "review": case "logs": case "pdf-diff":
      return { projectId: project.data, branch: branch?.data ?? null, page, shareToken: url.searchParams.get("share") };
    case undefined: return null;
    default: return null;
  }
}
/** Requests stay on the injected session client; share tokens never enter a global client. */
export async function loadEditorWorkspace(client: EditorClient, route: EditorRoute, signal?: AbortSignal): Promise<EditorWorkspace> {
  const headers = route.shareToken ? { "x-project-token": route.shareToken } : {};
  const project = editorValue(await client.call(endpoints.projectGet, {
    params: { p: route.projectId }, query: { branch: route.branch ?? "main" }, body: undefined, headers,
  }, signal));
  const scope = { projectId: project.id, branch: route.branch ?? project.defaultBranch };
  const [files, access] = await Promise.all([
    client.call(endpoints.filesList, { params: { p: project.id }, query: { branch: scope.branch }, body: undefined, headers }, signal),
    client.call(endpoints.projectAccess, { params: { p: project.id }, query: { branch: scope.branch }, body: undefined, headers }, signal),
  ]);
  return { scope, project, files: editorValue(files), access: editorValue(access), requestHeaders: headers };
}
