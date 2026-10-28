import { encodeStateVector } from "yjs";
import type { EditorDocument, SourceEdit, SourceSelection } from "../shared";
import { parseLatex } from "./parser";
import { escapeText, groupEnd, VisualEditError } from "./model";
import type { Interval } from "./model";
import type { ParsedLatex } from "./model";

/** Includes deletions, unlike a Yjs state vector alone. No mutable parser ranges escape. */
export function sourceRevision(document: EditorDocument): string {
  return `${document.getSnapshot().version.epoch}:${Array.from(encodeStateVector(document.ydoc)).join(".")}:${document.source.toJSON()}`;
}
export function parseDocument(document: EditorDocument): ParsedLatex {
  return parseLatex(document.source.toJSON(), sourceRevision(document));
}
export function applyVisualEdits(document: EditorDocument, parsed: ParsedLatex, edits: readonly SourceEdit[]): void {
  if (sourceRevision(document) !== parsed.revision || document.source.toJSON() !== parsed.source) {
    throw new VisualEditError("STALE_RANGE", "The source changed. Select the content again before applying this edit.");
  }
  for (const edit of edits) {
    if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to) || edit.from < 0 ||
      edit.to < edit.from || edit.to > parsed.source.length || splitsPair(parsed.source, edit.from) ||
      splitsPair(parsed.source, edit.to) || !edit.insert.isWellFormed()) {
      throw new VisualEditError("INVALID_RANGE", "Select complete source characters.");
    }
  }
  document.replace(edits);
}
/** Replace only the user's changed characters, not untouched syntax in the same field. */
export function fieldEdit(source: string, range: Interval,
  change: { readonly text: string; readonly literal: boolean }): SourceEdit {
  const previous = source.slice(range.from, range.to);
  let prefix = 0;
  while (prefix < previous.length && prefix < change.text.length && previous[prefix] === change.text[prefix]) prefix++;
  if (splitsPair(previous, prefix)) prefix--;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < change.text.length - prefix &&
    previous[previous.length - suffix - 1] === change.text[change.text.length - suffix - 1]) suffix++;
  if (splitsPair(previous, previous.length - suffix)) suffix--;
  const replacement = change.text.slice(prefix, change.text.length - suffix);
  return { from: range.from + prefix, to: range.to - suffix,
    insert: change.literal ? replacement : escapeText(replacement) };
}
function splitsPair(text: string, at: number): boolean {
  return /[\uD800-\uDBFF]/.test(text.charAt(at - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(at));
}
export function selectionEdit(selection: SourceSelection, insert: string): SourceEdit {
  return { from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head), insert };
}
/** Package insertion is a separate interval in the same atomic document command. */
export function withPackage(parsed: ParsedLatex, edit: SourceEdit, packageName: "graphicx"): readonly SourceEdit[] {
  let body = 0;
  for (let at = 0; at < parsed.source.length; at++) {
    if (parsed.source[at] === "%") {
      const newline = parsed.source.indexOf("\n", at);
      at = newline < 0 ? parsed.source.length : newline;
    } else if (parsed.source.startsWith("\\begin{document}", at)) { body = at; break; }
    else if (parsed.source[at] === "{") at = (groupEnd(parsed.source, at) ?? at + 1) - 1;
    else if (parsed.source[at] === "\\") {
      const packages = /^\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/.exec(parsed.source.slice(at));
      if (packages?.[1]?.split(",").map(name => name.trim()).includes(packageName)) return [edit];
      at += (/^\\(?:[a-zA-Z@]+|.)/.exec(parsed.source.slice(at))?.[0].length ?? 1) - 1;
    }
  }
  const at = body;
  const insert = `\\usepackage{${packageName}}\n`;
  if (at >= edit.from && at <= edit.to) {
    return [{ ...edit, insert: insert + edit.insert }];
  }
  return [{ from: at, to: at, insert }, edit];
}
