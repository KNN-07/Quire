export type Interval = { readonly from: number; readonly to: number };
export type VisualKind = "paragraph" | "heading" | "bold" | "italic" | "list" | "item"
  | "text" | "math" | "citation" | "reference" | "include" | "island" | "table" | "figure";
export type VisualNode = Interval & {
  readonly kind: VisualKind;
  readonly content: Interval;
  readonly command: string;
  readonly children: readonly VisualNode[];
};
export type ParsedLatex = {
  readonly source: string;
  readonly revision: string;
  readonly nodes: readonly VisualNode[];
};
export class VisualEditError extends Error {
  readonly name = "VisualEditError";
  constructor(readonly code: "STALE_RANGE" | "INVALID_RANGE" | "INVALID_INPUT" | "OFFLINE", message: string) {
    super(message);
  }
}
export function interval(from: number, to: number): Interval {
  return Object.freeze({ from, to });
}
export function node(kind: VisualKind, range: Interval,
  details: Partial<Pick<VisualNode, "content" | "command" | "children">> = {}): VisualNode {
  const { content = range, command = "", children = [] } = details;
  return Object.freeze({ kind, ...range, content: Object.freeze(content), command,
    children: Object.freeze(children) });
}
/** TeX comments end at a newline; escaped delimiters cannot change brace depth. */
export function groupEnd(source: string, start: number, limit = source.length): number | null {
  if (source[start] !== "{") return null;
  let depth = 1;
  for (let at = start + 1; at < limit; at++) {
    const char = source[at];
    if (char === "\\") { at++; continue; }
    if (char === "%") {
      const newline = source.indexOf("\n", at);
      if (newline < 0 || newline >= limit) return null;
      at = newline;
    } else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return at + 1;
  }
  return null;
}
export function escapeText(text: string): string {
  return text.replace(/[\\{}$&#%_^~]/g, character => {
    switch (character) {
      case "\\": return "\\textbackslash{}";
      case "^": return "\\textasciicircum{}";
      case "~": return "\\textasciitilde{}";
      default: return `\\${character}`;
    }
  });
}
