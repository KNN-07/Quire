import { endpoints } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { editorValue } from "../shared";
import type { EditorClient, EditorWorkspace, PdfLocation, SourceLocation } from "../shared";

export type PdfNavigationContext = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly jobId: Id;
};
export async function forwardSync(context: PdfNavigationContext, location: SourceLocation) {
  const result = editorValue(await context.client.call(endpoints.synctex, {
    params: { id: context.jobId }, query: {},
    body: { direction: "forward", ...location }, headers: context.workspace.requestHeaders,
  }));
  return result.flatMap(item => "page" in item ? [item] : []);
}
export async function reverseSync(context: PdfNavigationContext, location: PdfLocation) {
  const result = editorValue(await context.client.call(endpoints.synctex, {
    params: { id: context.jobId }, query: {},
    body: { direction: "reverse", ...location }, headers: context.workspace.requestHeaders,
  }));
  return result.flatMap(item => "fileId" in item ? [{ ...item, line: Math.max(1, item.line),
    column: Math.max(1, item.column) }] : []);
}
