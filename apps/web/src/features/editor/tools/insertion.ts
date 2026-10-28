import { assertNever, endpoints } from "@quire/contracts";
import { EditorApiError, editorValue } from "../shared";
import type { SourceEdit, ToolsPanelProps } from "../shared";

export function packageEdit(source: string, name: string): SourceEdit | null {
  const uncommented = source.split("\n").map(line => {
    for (let index = 0; index < line.length; index++) {
      if (line[index] === "\\") { index++; continue; }
      if (line[index] === "%") return line.slice(0, index) + " ".repeat(line.length - index);
    }
    return line;
  }).join("\n");
  let start = -1;
  for (let at = 0; at < uncommented.length; at++) {
    if (uncommented.startsWith("\\begin{document}", at)) { start = at; break; }
    if (uncommented[at] === "\\") {
      const match = /^\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]+)\}/.exec(uncommented.slice(at));
      if (match?.[1]?.split(",").map(value => value.trim()).includes(name)) return null;
      at += (/^\\(?:[a-zA-Z@]+|.)/.exec(uncommented.slice(at))?.[0].length ?? 1) - 1;
    } else if (uncommented[at] === "{") {
      // Package examples and document markers inside macro/group bodies do not
      // execute as preamble declarations.
      let depth = 1;
      while (++at < uncommented.length && depth) {
        if (uncommented[at] === "\\") { at++; continue; }
        if (uncommented[at] === "{") depth++;
        if (uncommented[at] === "}") depth--;
      }
      at--;
    }
  }
  if (start < 0) throw new EditorApiError("PREAMBLE_REQUIRED", "Open the main document to add the required package.");
  return { from: start, to: start, insert: `\\usepackage{${name}}\n` };
}

/** Source commands use the active authoring selection and the transport-owned Y.Text. */
export async function insertCommand(props: ToolsPanelProps, input: {
  readonly command: string; readonly packageName?: string; readonly isCurrent?: () => boolean;
}) {
  const { document, authoring } = props;
  if (!document || !authoring) throw new EditorApiError("NO_SOURCE", "Open an editable source file before inserting.");
  const snapshot = document.getSnapshot();
  if (snapshot.readOnly || !props.workspace.access.capabilities.edit) {
    throw new EditorApiError("READ_ONLY", snapshot.readOnlyReason ?? "Source is read only.");
  }
  switch (snapshot.persistence.kind) {
    case "offline": case "recovery": case "closed": case "connecting":
      throw new EditorApiError("DOCUMENT_UNAVAILABLE", "Reconnect or recover the document before inserting.");
    case "saved": case "saving": break;
    default: assertNever(snapshot.persistence);
  }
  let edit: SourceEdit | null = null;
  if (input.packageName) {
    if (document.file.id === props.workspace.project.settings.mainFileId) {
      edit = packageEdit(document.source.toJSON(), input.packageName);
    } else {
      const main = editorValue(await props.client.call(endpoints.fileDocument, {
        params: { p: props.workspace.scope.projectId, f: props.workspace.project.settings.mainFileId },
        query: { branch: props.workspace.scope.branch }, body: undefined, headers: props.workspace.requestHeaders,
      }));
      if (packageEdit(main.text, input.packageName)) {
        throw new EditorApiError("PACKAGE_REQUIRED", `Open ${main.file.path} and add \\usepackage{${input.packageName}} before inserting here.`);
      }
    }
  }
  if (input.isCurrent && !input.isCurrent()) throw new EditorApiError("STALE_DOCUMENT", "The selected source document changed.");
  if (document.getSnapshot().readOnly) throw new EditorApiError("READ_ONLY", "Source is read only.");
  // Insert at the current editor cursor first, so a preamble edit cannot stale its offsets.
  authoring.replaceSelection(input.command);
  if (edit) {
    const current = packageEdit(document.source.toJSON(), input.packageName ?? "");
    if (current) document.replace([current]);
  }
  authoring.focus();
}

export type CitationKey = { readonly key: string; readonly offset: number };
/** Walk balanced entries, rather than mistaking @ text inside a field for a key. */
export function bibliographyKeys(source: string): readonly CitationKey[] {
  const keys: CitationKey[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (source[offset] === "%") {
      const end = source.indexOf("\n", offset);
      offset = end < 0 ? source.length : end + 1;
      continue;
    }
    const header = /^@([a-z]+)\s*([{(])/i.exec(source.slice(offset));
    if (!header) { offset++; continue; }
    const start = offset;
    const kind = header[1]?.toLowerCase();
    const close = header[2] === "(" ? ")" : "}";
    offset += header[0].length;
    const key = /^\s*([\w:./+-]+)\s*,/.exec(source.slice(offset))?.[1];
    let depth = 0;
    let quoted = false;
    let complete = false;
    while (offset < source.length) {
      const token = source[offset++];
      if (token === "\\") { offset++; continue; }
      if (token === '"' && depth === 0) quoted = !quoted;
      if (!quoted && depth === 0 && token === close) { complete = true; break; }
      if (token === "{") depth++;
      if (token === "}") depth--;
    }
    if (complete && key && kind !== "comment" && kind !== "string" && kind !== "preamble") keys.push({ key, offset: start });
  }
  return keys;
}
