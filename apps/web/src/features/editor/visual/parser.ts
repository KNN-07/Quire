import { parseInline } from "./inline";
import { groupEnd, interval, node } from "./model";
import type { ParsedLatex, VisualNode } from "./model";

/** Top-level ranges cover the original source exactly, including invisible whitespace. */
export function parseLatex(source: string, revision: string): ParsedLatex {
  const nodes: VisualNode[] = [];
  let at = 0;
  while (at < source.length) {
    const start = at;
    const heading = /^\\(section|subsection|subsubsection|chapter|title)\*?\{/.exec(source.slice(at));
    const environment = /^\\begin\{([^}]+)\}/.exec(source.slice(at));
    if (heading) {
      const open = at + heading[0].length - 1;
      const end = groupEnd(source, open);
      if (end !== null) {
        const content = interval(open + 1, end - 1);
        nodes.push(node("heading", interval(at, end), { content, command: heading[1] ?? "", children: parseInline(source, content) }));
        at = end;
        continue;
      }
    }
    if (environment) {
      const name = environment[1] ?? "";
      if (name === "document") {
        at += environment[0].length;
        nodes.push(node("island", interval(start, at), { command: "document boundary" }));
        continue;
      }
      const end = environmentEnd(source, at, name);
      if (end !== null) {
        const content = interval(at + environment[0].length, end - `\\end{${name}}`.length);
        const range = interval(at, end);
        switch (name) {
          case "itemize": case "enumerate":
            nodes.push(source.slice(content.from, content.to).includes("\\begin{")
              ? node("island", range, { command: `${name} with nested structure` })
              : node("list", range, { content, command: name, children: parseItems(source, content) }));
            break;
          case "tabular": nodes.push(node("table", range, { content, command: name })); break;
          case "figure": case "figure*": nodes.push(node("figure", range, { content, command: name })); break;
          case "equation": case "equation*": case "align": case "align*": case "displaymath":
            nodes.push(node("math", range, { content, command: name })); break;
          default: nodes.push(node("island", range, { command: name }));
        }
        at = end;
        continue;
      }
    }
    if (/\s/.test(source[at] ?? "")) {
      while (at < source.length && /\s/.test(source[at] ?? "")) at++;
      nodes.push(node("text", interval(start, at)));
      continue;
    }
    // Paragraphs stop before blank lines or structural commands, never inside groups.
    while (at < source.length) {
      if (at > start && (/^\s*\n\s*\n/.test(source.slice(at)) ||
        /^\\(?:begin|end|section|subsection|subsubsection|chapter|title)\b/.test(source.slice(at)))) break;
      if (source[at] === "%") {
        const newline = source.indexOf("\n", at);
        at = newline < 0 ? source.length : newline;
      } else if (source[at] === "\\") { at += Math.min(2, source.length - at); }
      else if (source[at] === "{") { at = groupEnd(source, at) ?? at + 1; }
      else at++;
    }
    const range = interval(start, at);
    nodes.push(node("paragraph", range, { children: parseInline(source, range) }));
  }
  return Object.freeze({ source, revision, nodes: Object.freeze(nodes) });
}
function environmentEnd(source: string, start: number, name: string): number | null {
  const open = `\\begin{${name}}`;
  const close = `\\end{${name}}`;
  let depth = 0;
  for (let at = start; at < source.length; at++) {
    if (source[at] === "%") {
      const newline = source.indexOf("\n", at);
      if (newline < 0) return null;
      at = newline;
    } else if (source.startsWith(open, at)) {
      depth++;
      at += open.length - 1;
    } else if (source.startsWith(close, at)) {
      if (--depth === 0) return at + close.length;
      at += close.length - 1;
    } else if (source[at] === "\\") at++;
  }
  return null;
}
function parseItems(source: string, content: { readonly from: number; readonly to: number }): readonly VisualNode[] {
  const starts: number[] = [];
  for (let at = content.from; at < content.to; at++) {
    if (/^\\item(?:\s|$)/.test(source.slice(at, content.to))) starts.push(at);
    else if (source[at] === "{") at = (groupEnd(source, at, content.to) ?? at + 1) - 1;
    else if (source[at] === "%") {
      const newline = source.indexOf("\n", at);
      at = newline < 0 ? content.to : newline;
    } else if (source[at] === "\\") at++;
  }
  const first = starts[0] ?? content.to;
  const prefix = interval(content.from, first);
  const items = starts.map((start, index) => {
    const end = starts[index + 1] ?? content.to;
    const range = interval(start + 5, end);
    return node("item", interval(start, end), { content: range, children: parseInline(source, range) });
  });
  if (source.slice(prefix.from, prefix.to).trim()) {
    items.unshift(node("item", prefix, { children: [node("island", prefix)] }));
  }
  return Object.freeze(items);
}
