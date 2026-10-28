import { groupEnd, interval, VisualEditError, escapeText } from "./model";
import type { Interval, VisualNode } from "./model";

export type TableShape = {
  readonly columns: Interval;
  readonly rows: readonly (readonly Interval[])[];
};
/** Only simple l/c/r tabular is interpreted; complex layouts stay editable source. */
export function tableShape(source: string, table: VisualNode): TableShape | null {
  let at = table.content.from;
  while (/\s/.test(source[at] ?? "")) at++;
  const end = groupEnd(source, at, table.content.to);
  if (end === null || !/^[lcr| ]+$/.test(source.slice(at + 1, end - 1))) return null;
  const columns = interval(at + 1, end - 1);
  at = end;
  const rows: (readonly Interval[])[] = [];
  let cells: Interval[] = [];
  let start = at;
  while (at < table.content.to) {
    const char = source[at];
    if (char === "%") return null;
    if (char === "{") {
      const close = groupEnd(source, at, table.content.to);
      if (close === null) return null;
      at = close;
    } else if (source.startsWith("\\\\", at)) {
      cells.push(trimInterval(source, interval(start, at)));
      rows.push(Object.freeze(cells));
      cells = [];
      at += 2;
      start = at;
    } else if (char === "&") {
      cells.push(trimInterval(source, interval(start, at)));
      start = ++at;
    } else if (char === "\\") {
      if (/^\\(?:hline|cline|multicolumn|multirow|begin)\b/.test(source.slice(at))) return null;
      at += 2;
    } else at++;
  }
  if (source.slice(start, table.content.to).trim() || cells.length) {
    cells.push(trimInterval(source, interval(start, table.content.to)));
    rows.push(Object.freeze(cells));
  }
  const count = source.slice(columns.from, columns.to).replace(/[^lcr]/g, "").length;
  if (rows.some(row => row.length !== count)) return null;
  return Object.freeze({ columns, rows: Object.freeze(rows) });
}
export function trimInterval(source: string, range: Interval): Interval {
  const text = source.slice(range.from, range.to);
  return interval(range.from + text.length - text.trimStart().length,
    range.to - text.length + text.trimEnd().length);
}
export function commandField(source: string, region: Interval, command: string): Interval | null {
  for (let at = region.from; at < region.to; at++) {
    if (source[at] === "%") {
      const newline = source.indexOf("\n", at);
      at = newline < 0 ? region.to : newline;
    } else if (source.startsWith(`\\${command}{`, at)) {
      const open = at + command.length + 1;
      const end = groupEnd(source, open, region.to);
      return end === null ? null : interval(open + 1, end - 1);
    } else if (source[at] === "{") at = (groupEnd(source, at, region.to) ?? at + 1) - 1;
    else if (source[at] === "\\") at++;
  }
  return null;
}
export type FigureShape = {
  readonly path: Interval;
  readonly options: Interval | null;
  readonly caption: Interval | null;
  readonly label: Interval | null;
};
export function figureShape(source: string, figure: VisualNode): FigureShape | null {
  const raw = source.slice(figure.content.from, figure.content.to);
  // Preserve offsets while excluding comment examples from figure recognition.
  const visible = raw.split("");
  for (let at = 0; at < raw.length; at++) {
    if (raw[at] === "\\") at++;
    else if (raw[at] === "%") {
      while (at < raw.length && raw[at] !== "\n") visible[at++] = " ";
    }
  }
  const active = visible.join("");
  const match = /\\includegraphics(\[[^\]]*\])?\{([^{}]+)\}/.exec(active);
  if (!match || active.indexOf("\\includegraphics", match.index + 1) >= 0) return null;
  const caption = commandField(source, figure.content, "caption");
  const label = commandField(source, figure.content, "label");
  if ((!caption && /\\caption\b/.test(active)) || (!label && /\\label\b/.test(active))) return null;
  const start = figure.content.from + match.index + "\\includegraphics".length;
  const options = match[1] ? interval(start + 1, start + match[1].length - 1) : null;
  const open = start + (match[1]?.length ?? 0);
  return Object.freeze({
    path: interval(open + 1, open + 1 + (match[2]?.length ?? 0)), options,
    caption, label,
  });
}
export function tsvTable(text: string): string {
  const rows = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map(row => row.split("\t"));
  const width = rows[0]?.length ?? 0;
  if (width < 1 || rows.some(row => row.length !== width)) {
    throw new VisualEditError("INVALID_INPUT", "Paste a rectangular table with the same number of cells in each row.");
  }
  return `\\begin{tabular}{${"l".repeat(width)}}\n${rows.map(row => row.map(escapeText).join(" & ")).join(" \\\\\n")} \\\\\n\\end{tabular}`;
}
