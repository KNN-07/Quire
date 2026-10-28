import { expect, test } from "bun:test";
import { parseDocument, applyVisualEdits, withPackage } from "../../../apps/web/src/features/editor/visual/commands";
import { VisualEditError } from "../../../apps/web/src/features/editor/visual/model";
import { transportFixture } from "../transport/harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { tableShape } from "../../../apps/web/src/features/editor/visual/structures";
import type { VisualNode } from "../../../apps/web/src/features/editor/visual/model";
import { TransportError } from "../../../apps/web/src/features/editor/transport";

test("edits source intervals through the shared document and persists unknown bytes after restart", async () => {
  // Given: real service, Y.Doc and durable acknowledgement.
  await using setup = await transportFixture();
  const user = await setup.user();
  const source = "\\documentclass{article}\n%  untouched  \n\\newcommand{\\x}[1]{#1}\n\\begin{document}\n\\section{Old 😀}\n\\x{ unknown }\n\\end{document}\n";
  user.document.replace([{ from: 0, to: user.document.source.length, insert: source }]);
  await user.document.flush(AbortSignal.timeout(10_000));
  const parsed = parseDocument(user.document);
  const heading = parsed.nodes.find(entry => entry.kind === "heading");
  if (!heading) throw new TypeError("Heading missing");
  // When
  applyVisualEdits(user.document, parsed, [{ ...heading.content, insert: "New 文 😀" }]);
  await user.document.flush(AbortSignal.timeout(10_000));
  await user.transport.dispose();
  await setup.fixture.restart();
  const saved = await setup.fixture.service.loadDocument(user.workspace.scope, ids.mainFile);
  // Then
  expect(saved.text).toBe(source.replace("Old 😀", "New 文 😀"));
});
test("rejects stale parser ranges after a concurrent source mutation", async () => {
  // Given
  await using setup = await transportFixture();
  const user = await setup.user();
  const parsed = parseDocument(user.document);
  user.document.replace([{ from: 0, to: 0, insert: "% concurrent\n" }]);
  // When / Then
  expect(() => applyVisualEdits(user.document, parsed, [{ from: 0, to: 1, insert: "X" }])).toThrow(VisualEditError);
  expect(user.document.source.toJSON().startsWith("% concurrent\n")).toBe(true);
});
test("rejects intervals that split a non-BMP source character", async () => {
  // Given
  await using setup = await transportFixture();
  const user = await setup.user();
  user.document.replace([{ from: 0, to: 0, insert: "😀" }]);
  const parsed = parseDocument(user.document);
  // When / Then
  expect(() => applyVisualEdits(user.document, parsed, [{ from: 1, to: 1, insert: "X" }])).toThrow(VisualEditError);
  expect(user.document.source.toJSON().startsWith("😀")).toBe(true);
});
test("inserts graphicx once atomically with a figure and leaves commented package text alone", async () => {
  // Given
  await using setup = await transportFixture();
  const user = await setup.user();
  const text = "\\documentclass{article}\n% \\usepackage{graphicx} \\begin{document}\n\\newcommand{\\unused}{\\usepackage{graphicx}}\n\\begin{document}\nBody\n\\end{document}";
  user.document.replace([{ from: 0, to: user.document.source.length, insert: text }]);
  const parsed = parseDocument(user.document);
  const at = text.indexOf("Body");
  // When
  applyVisualEdits(user.document, parsed, withPackage(parsed, { from: at, to: at, insert: "\\includegraphics{a.png}\n" }, "graphicx"));
  const next = parseDocument(user.document);
  const repeated = withPackage(next, { from: next.source.length, to: next.source.length, insert: "\n" }, "graphicx");
  await user.document.flush(AbortSignal.timeout(10_000));
  // Then
  expect(next.source).toBe(text.replace("\n\\begin{document}", "\n\\usepackage{graphicx}\n\\begin{document}")
    .replace("Body", "\\includegraphics{a.png}\nBody"));
  expect(repeated).toHaveLength(1);
});
function flatten(nodes: readonly VisualNode[]): readonly VisualNode[] {
  return nodes.flatMap(entry => [entry, ...flatten(entry.children)]);
}
test("edits emphasis list math citation reference include and table targets without reserializing", async () => {
  // Given
  await using setup = await transportFixture();
  const user = await setup.user();
  const text = String.raw`\documentclass{article}
\begin{document}
Text \textbf{bold} \emph{italic} $x+1$ \citep[p.2]{old} \ref{sec:old}
\begin{itemize}\item first\end{itemize}
\begin{tabular}{lr}left & right\\\end{tabular}
\input{old-file}
\mystery [x] { untouched  source } % exact spaces
\end{document}`;
  user.document.replace([{ from: 0, to: user.document.source.length, insert: text }]);
  const parsed = parseDocument(user.document);
  const nodes = flatten(parsed.nodes);
  const replacements: Readonly<Record<string, string>> = {
    bold: "strong", italic: "emphasized", math: "y^2", citation: "new", reference: "sec:new", include: "new-file",
  };
  const edits = nodes.flatMap(entry => {
    const insert = replacements[entry.kind];
    return insert === undefined ? [] : [{ ...entry.content, insert }];
  });
  const item = nodes.find(entry => entry.kind === "item");
  const table = nodes.find(entry => entry.kind === "table");
  if (!item || !table) throw new TypeError("Fixture structures missing");
  edits.push({ ...item.content, insert: " second" });
  const cell = tableShape(text, table)?.rows[0]?.[0];
  if (!cell) throw new TypeError("Fixture cell missing");
  edits.push({ ...cell, insert: "changed" });
  // When: one atomic batch over original parser ranges.
  applyVisualEdits(user.document, parsed, edits);
  await user.document.flush(AbortSignal.timeout(10_000));
  // Then: unrelated syntax and every source delimiter remain byte-identical.
  expect(user.document.source.toJSON()).toBe(text.replace("{bold}", "{strong}").replace("{italic}", "{emphasized}")
    .replace("$x+1$", "$y^2$").replace("{old}", "{new}").replace("{sec:old}", "{sec:new}")
    .replace("\\item first", "\\item second").replace("left &", "changed &").replace("{old-file}", "{new-file}"));
});
test("rejects visual source commands for an actual read-only viewer", async () => {
  // Given
  await using setup = await transportFixture();
  const user = await setup.user("alex@quire.local");
  const parsed = parseDocument(user.document);
  // When / Then
  expect(() => applyVisualEdits(user.document, parsed, [{ from: 0, to: 0, insert: "% forbidden\n" }]))
    .toThrow(TransportError);
  expect(user.document.source.toJSON()).toBe(parsed.source);
  expect(user.document.getSnapshot().readOnly).toBe(true);
});
