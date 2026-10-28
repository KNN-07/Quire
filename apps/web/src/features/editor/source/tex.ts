import type { SourceSelection } from "../shared";

export type TexHeading = {
  readonly from: number;
  readonly to: number;
  readonly level: number;
  readonly title: string;
};
export type TexIndex = {
  readonly headings: readonly TexHeading[];
  readonly labels: readonly string[];
  readonly citations: readonly string[];
};

/** Mask comments and verbatim while retaining every original UTF-16 offset. */
export function maskedTex(source: string): string {
  return source.replace(
    /\\begin\{(verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{\1\}|\\verb\*?([^\w\s])[\s\S]*?\2|\\[%\\]|%[^\n]*/g,
    match => match.startsWith("\\%") || match === "\\\\" ? match : match.replace(/[^\n]/g, " "),
  );
}

/** Brace-aware argument extraction; no source regeneration or include expansion. */
export function texIndex(source: string): TexIndex {
  const text = maskedTex(source);
  const headings: TexHeading[] = [];
  const labels: string[] = [];
  const levels = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"];
  for (const match of text.matchAll(/\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|label)\*?(?:\[[^\]]*\])?\s*\{/g)) {
    const command = match[1];
    if (!command) continue;
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (end < text.length && depth > 0) {
      if (text[end] === "\\" && /[{}]/.test(text[end + 1] ?? "")) { end += 2; continue; }
      if (text[end] === "{") depth++;
      if (text[end] === "}") depth--;
      if (depth > 0) end++;
    }
    if (depth > 0) continue;
    const title = source.slice(start, end);
    if (command === "label") labels.push(title);
    else headings.push({ from: match.index, to: end + 1, level: levels.indexOf(command), title });
  }
  const citations = [...source.matchAll(/^\s*@(?!comment\b|string\b|preamble\b)[\w-]+\s*[{(]\s*([^,\s]+)\s*,/gim)]
    .flatMap(match => match[1] ? [match[1]] : []);
  return { headings, labels: [...new Set(labels)], citations: [...new Set(citations)] };
}

/** Clamp to a code point boundary, never the middle of a surrogate pair. */
export function sourceOffset(source: string, offset: number): number {
  const bounded = Math.max(0, Math.min(source.length, Math.trunc(offset)));
  const current = source.charCodeAt(bounded);
  const previous = source.charCodeAt(bounded - 1);
  return current >= 0xdc00 && current <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff
    ? bounded - 1 : bounded;
}

export function sourceSelection(source: string, selection: SourceSelection): SourceSelection {
  return { anchor: sourceOffset(source, selection.anchor), head: sourceOffset(source, selection.head) };
}

export function lineOffset(source: string, location: { readonly line: number; readonly column: number }): number {
  const lines = source.split("\n");
  const line = Math.max(1, Math.min(lines.length, location.line));
  const start = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
  return sourceOffset(source, start + Math.min(lines[line - 1]?.length ?? 0, Math.max(0, location.column - 1)));
}
