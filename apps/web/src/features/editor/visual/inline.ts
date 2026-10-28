import { groupEnd, interval, node } from "./model";
import type { VisualKind, VisualNode } from "./model";

const commands: Readonly<Record<string, VisualKind>> = {
  textbf: "bold", textit: "italic", emph: "italic", cite: "citation", citep: "citation",
  citet: "citation", ref: "reference", eqref: "reference", pageref: "reference",
  input: "include", include: "include", label: "reference",
};
/** A conservative scanner: unrecognized syntax is never interpreted or normalized. */
export function parseInline(source: string, range: { readonly from: number; readonly to: number }): readonly VisualNode[] {
  const nodes: VisualNode[] = [];
  let at = range.from;
  while (at < range.to) {
    const start = at;
    const char = source[at];
    if (char === "%") {
      const end = source.indexOf("\n", at);
      at = end < 0 ? range.to : Math.min(end, range.to);
      nodes.push(node("island", interval(start, at), { command: "comment" }));
    } else if (char === "$" || source.startsWith("\\(", at) || source.startsWith("\\[", at)) {
      const open = char === "$" ? (source.startsWith("$$", at) ? "$$" : "$") : source.slice(at, at + 2);
      const close = open === "\\(" ? "\\)" : open === "\\[" ? "\\]" : open;
      at += open.length;
      let end = at;
      while (end < range.to && !source.startsWith(close, end)) {
        if (source[end] === "%") {
          const newline = source.indexOf("\n", end);
          end = newline < 0 ? range.to : newline;
        } else if (source[end] === "\\") end++;
        end++;
      }
      if (end >= range.to) {
        nodes.push(node("island", interval(start, range.to)));
        at = range.to;
      } else {
        at = end + close.length;
        nodes.push(node("math", interval(start, at), { content: interval(start + open.length, end), command: open }));
      }
    } else if (char === "\\") {
      const match = /^\\([a-zA-Z@]+\*?|.)/.exec(source.slice(at, range.to));
      const command = match?.[1] ?? "";
      at += match?.[0].length ?? 1;
      if (command === "verb" || command === "verb*") {
        const delimiter = source[at];
        const end = delimiter ? source.indexOf(delimiter, at + 1) : -1;
        at = end < 0 || end >= range.to ? range.to : end + 1;
        nodes.push(node("island", interval(start, at), { command }));
        continue;
      }
      const kind = commands[command];
      let argument = at;
      if (kind) {
        argument += /^\s*/.exec(source.slice(argument, range.to))?.[0].length ?? 0;
        if (kind === "citation") {
          while (source[argument] === "[") {
            const close = source.indexOf("]", argument);
            if (close < 0 || close >= range.to) break;
            argument = close + 1;
          }
        }
      }
      const end = groupEnd(source, argument, range.to);
      if (kind && end !== null) {
        const content = interval(argument + 1, end - 1);
        nodes.push(node(kind, interval(start, end), { content, command,
          children: kind === "bold" || kind === "italic" ? parseInline(source, content) : [] }));
        at = end;
      } else {
        // Unknown commands plus their options/groups form one opaque source island.
        while (at < range.to) {
          const whitespace = /^\s*/.exec(source.slice(at, range.to))?.[0].length ?? 0;
          const optionAt = at + whitespace;
          if (source[optionAt] === "[") {
            const close = source.indexOf("]", optionAt);
            if (close < 0 || close >= range.to) break;
            at = close + 1;
          } else {
            const close = groupEnd(source, optionAt, range.to);
            if (close === null) break;
            at = close;
          }
        }
        nodes.push(node("island", interval(start, at)));
      }
    } else if (char === "{" || char === "}") {
      const end = groupEnd(source, at, range.to);
      at = end ?? at + 1;
      nodes.push(node("island", interval(start, at)));
    } else {
      while (at < range.to && !/[\\%${}]/.test(source[at] ?? "")) at++;
      nodes.push(node("text", interval(start, at)));
    }
  }
  return Object.freeze(nodes);
}
