import { expect, test } from "bun:test";
import { parseLatex } from "../../../apps/web/src/features/editor/visual/parser";
import { tableShape, figureShape, tsvTable } from "../../../apps/web/src/features/editor/visual/structures";
import { VisualEditError } from "../../../apps/web/src/features/editor/visual/model";
import type { VisualNode } from "../../../apps/web/src/features/editor/visual/model";
import { fieldEdit } from "../../../apps/web/src/features/editor/visual/commands";

const original = String.raw`\documentclass{article}
% keep  spaces   and \unknown{inside comment}
\newcommand{\alien}[2]{#1 : #2}
\begin{document}
\section{A \emph{nested} heading}
First 😀 paragraph \textbf{bold} and \alien [x] {untouched}  .

\begin{itemize}
\item One $x^2$ \cite{key}
\item Two \ref{fig:test}
\end{itemize}
\[
\alpha + \beta
\]
\begin{tabular}{lc}
A & B \\
C & D \\
\end{tabular}
\begin{figure}
\includegraphics[keepaspectratio,width=0.5\textwidth]{images/test.png}
\caption{A picture}
\label{fig:test}
\end{figure}
\input{parts/extra}
\begin{mystery}preserve {everything} % comment
\end{mystery}
\end{document}
`;
function flatten(nodes: readonly VisualNode[]): readonly VisualNode[] {
  return nodes.flatMap(entry => [entry, ...flatten(entry.children)]);
}
test("partitions source without dropping unknown macros comments or whitespace", () => {
  // Given
  const parsed = parseLatex(original, "revision-1");
  // When
  const recovered = parsed.nodes.map(entry => original.slice(entry.from, entry.to)).join("");
  // Then
  expect(recovered).toBe(original);
  expect(flatten(parsed.nodes).map(entry => entry.kind)).toEqual(expect.arrayContaining([
    "paragraph", "heading", "bold", "italic", "list", "item", "math", "citation",
    "reference", "table", "figure", "include", "island",
  ]));
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(flatten(parsed.nodes).every(entry => Object.isFrozen(entry) && Object.isFrozen(entry.content) &&
    Object.isFrozen(entry.children))).toBe(true);
});
test("locates simple cells and figure fields without consuming adjacent source", () => {
  // Given
  const parsed = parseLatex(original, "revision-1");
  const table = parsed.nodes.find(entry => entry.kind === "table");
  const figure = parsed.nodes.find(entry => entry.kind === "figure");
  if (!table || !figure) throw new TypeError("Fixture structures missing");
  // When
  const cells = tableShape(original, table);
  const image = figureShape(original, figure);
  // Then
  expect(cells?.rows.map(row => row.map(cell => original.slice(cell.from, cell.to)))).toEqual([["A", "B"], ["C", "D"]]);
  expect(image && original.slice(image.path.from, image.path.to)).toBe("images/test.png");
  expect(image?.caption && original.slice(image.caption.from, image.caption.to)).toBe("A picture");
});
test("preserves complex tables as source rather than guessing cell boundaries", () => {
  // Given
  const source = String.raw`\begin{tabular}{p{2cm}r}a & b\\\end{tabular}`;
  const table = parseLatex(source, "r").nodes[0];
  if (!table) throw new TypeError("Missing table");
  // When
  const result = tableShape(source, table);
  // Then
  expect(result).toBeNull();
});
test("escapes pasted TSV cells and rejects ragged tables", () => {
  // Given
  const text = "A&B\t50%\r\n😀\t$2";
  // When
  const table = tsvTable(text);
  const parsed = parseLatex(table, "r").nodes[0];
  if (!parsed) throw new TypeError("Missing table");
  // Then
  expect(tableShape(table, parsed)?.rows.map(row => row.map(cell => table.slice(cell.from, cell.to))))
    .toEqual([["A\\&B", "50\\%"], ["😀", "\\$2"]]);
  expect(() => tsvTable("A\tB\nC")).toThrow(VisualEditError);
});
test("does not treat commented environment endings or escaped braces as structure", () => {
  // Given
  const source = "\\begin{mystery}% \\end{mystery}\n{a\\}b}\\end{mystery}\nTail";
  // When
  const parsed = parseLatex(source, "r");
  // Then
  expect(parsed.nodes[0]?.kind).toBe("island");
  expect(source.slice(0, parsed.nodes[0]?.to)).toBe("\\begin{mystery}% \\end{mystery}\n{a\\}b}\\end{mystery}");
  expect(parsed.nodes.map(entry => source.slice(entry.from, entry.to)).join("")).toBe(source);
});
test("keeps unknown spaced arguments and verbatim delimiters in source islands", () => {
  // Given
  const source = String.raw`\custom [option] { exact  {nested} } \verb|$not math%{}| tail`;
  // When
  const leaves = flatten(parseLatex(source, "r").nodes).filter(entry => entry.kind === "island");
  // Then
  expect(leaves.map(entry => source.slice(entry.from, entry.to))).toEqual([
    "\\custom [option] { exact  {nested} }", "\\verb|$not math%{}|",
  ]);
});
test("edits citation targets while keeping optional citation notes outside the range", () => {
  // Given
  const source = String.raw`See \citep[compare][p.~12]{old:key}.`;
  // When
  const cite = flatten(parseLatex(source, "r").nodes).find(entry => entry.kind === "citation");
  // Then
  expect(cite && source.slice(cite.content.from, cite.content.to)).toBe("old:key");
  expect(cite && source.slice(cite.from, cite.content.from)).toBe("\\citep[compare][p.~12]{");
});
test("changes only inserted field characters without escaping untouched source or splitting emoji", () => {
  // Given
  const source = "before  😀 raw_thing  after";
  // When
  const edit = fieldEdit(source, { from: 0, to: source.length },
    { text: "before  文😀 raw_thing  after", literal: false });
  // Then
  expect(edit).toEqual({ from: 8, to: 8, insert: "文" });
  expect(fieldEdit("😀", { from: 0, to: 2 }, { text: "😃", literal: false }))
    .toEqual({ from: 0, to: 2, insert: "😃" });
});
test("ignores commented image examples and preserves unsupported caption forms as source", () => {
  // Given
  const source = "\\begin{figure}\n% 😀 \\includegraphics{not-real.png}\n\\includegraphics{actual.png}\n\\caption{Plain}\n\\end{figure}";
  const figure = parseLatex(source, "r").nodes[0];
  if (!figure) throw new TypeError("Missing figure");
  // When
  const shape = figureShape(source, figure);
  const complex = source.replace("\\caption{Plain}", "\\caption[Short]{Long}");
  const complexFigure = parseLatex(complex, "r").nodes[0];
  if (!complexFigure) throw new TypeError("Missing complex figure");
  // Then
  expect(shape && source.slice(shape.path.from, shape.path.to)).toBe("actual.png");
  expect(figureShape(complex, complexFigure)).toBeNull();
});
