import { endpoints } from "@quire/contracts";
import type { EditorClient, EditorWorkspace, EditorDocument } from "../shared";
import { editorValue } from "../shared";
import { texIndex } from "./tex";
import type { TexIndex } from "./tex";

export async function projectCompletionIndex(
  input: { readonly client: EditorClient; readonly workspace: EditorWorkspace; readonly document: EditorDocument },
  signal: AbortSignal,
): Promise<TexIndex> {
  const { client, workspace, document } = input;
  const files = workspace.files.filter(file => file.id !== document.file.id && file.kind === "file"
    && (file.editable && /\.tex$/i.test(file.path) || /\.bib$/i.test(file.path)));
  const indexes = await Promise.all(files.map(async file => {
    if (!file.editable || file.link) {
      const result = await client.call(endpoints.fileContent, {
        params: { p: workspace.scope.projectId, f: file.id }, query: { branch: workspace.scope.branch },
        body: undefined, headers: workspace.requestHeaders,
      }, signal);
      return texIndex(new TextDecoder().decode(editorValue(result)));
    }
    const result = await client.call(endpoints.fileDocument, {
      params: { p: workspace.scope.projectId, f: file.id }, query: { branch: workspace.scope.branch },
      body: undefined, headers: workspace.requestHeaders,
    }, signal);
    return texIndex(editorValue(result).text);
  }));
  return {
    headings: [],
    labels: [...new Set(indexes.flatMap(index => index.labels))],
    citations: [...new Set(indexes.flatMap(index => index.citations))],
  };
}
