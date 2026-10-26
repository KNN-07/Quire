import { expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { StreamLanguage, syntaxTree } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";

test("parses LaTeX commands when the pinned editor packages are composed", () => {
  // Given: the actual installed language and editor state packages.
  const source = "\\section{Introduction}\nText with $x^2$.";
  // When: a state is built with the LaTeX tokenizer.
  const state = EditorState.create({ doc: source, extensions: [StreamLanguage.define(stex)] });
  // Then: the parser covers the document and recognizes non-plain-text tokens.
  const tree = syntaxTree(state);
  expect(tree.length).toBe(source.length);
  expect(tree.topNode.firstChild).not.toBeNull();
});
