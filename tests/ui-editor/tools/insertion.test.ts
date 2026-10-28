import { describe, expect, test } from "bun:test";
import { bibliographyKeys, packageEdit } from "../../../apps/web/src/features/editor/tools/insertion";
import { EditorApiError } from "../../../apps/web/src/features/editor/shared";
import { PythonResultSchema } from "../../../apps/web/src/features/editor/tools/python-contract";

describe("tool source operations", () => {
  test("adds a missing package when a main preamble exists", () => {
    // Given source with untouched comments and an unknown macro.
    const source = "\\documentclass{article}\n% \\usepackage{graphicx}\n\\newcommand\\x{未知😀}\n\\begin{document}x\\end{document}";
    // When the required package edit is applied.
    const edit = packageEdit(source, "graphicx");
    if (!edit) throw new TypeError("Missing required edit");
    const updated = source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
    // Then only the insertion changes original source bytes.
    expect(updated).toBe(source.replace("\\begin{document}", "\\usepackage{graphicx}\n\\begin{document}"));
  });
  test("does not duplicate packages when a multi-package declaration already exists", () => {
    // Given an existing package declaration with options.
    const source = "\\usepackage[option]{ amsmath, amssymb }\n\\begin{document}";
    // When a symbol requests amssymb.
    const edit = packageEdit(source, "amssymb");
    // Then no package write is needed.
    expect(edit).toBeNull();
  });
  test("rejects preamble writes when the source is an included section", () => {
    // Given a section file with no preamble.
    const source = "\\section{Results}";
    // When a new package is requested, then navigation to main is required.
    expect(() => packageEdit(source, "graphicx")).toThrow(EditorApiError);
  });
  test("reads citation keys when field values contain nested braces and at signs", () => {
    // Given balanced entries with a misleading entry-looking field value and comments.
    const source = "% @article{comment, title={No}}\n@article{first, title={nested @article{fake,} {x}}, author=\"A\"}\n@book(second, title={Book})";
    // When keys are indexed.
    const keys = bibliographyKeys(source);
    // Then source-level keys retain their offsets without false nested records.
    expect(keys.map(entry => entry.key)).toEqual(["first", "second"]);
    expect(keys.every(entry => source[entry.offset] === "@")).toBe(true);
  });
  test("rejects hostile generated paths when runtime output crosses the worker boundary", () => {
    // Given a worker payload attempting to escape the project.
    const payload = { kind: "complete", id: crypto.randomUUID(), version: "test", stdout: [],
      files: [{ path: "../secret", bytes: new Uint8Array([1]) }] };
    // When parsed, then the boundary rejects it before upload.
    expect(PythonResultSchema.safeParse(payload).success).toBe(false);
  });
  test("skips declarations and unfinished entries when indexing citation keys", () => {
    // Given declarations containing misleading record-looking text.
    const source = '@string{macro = "@article{fake,title={No}}"}\n@comment{ @book{false,title={No}} }\n@article{real,title={Yes}}\n@article{unfinished,title={No}';
    // When keys are indexed, then only the complete real record is offered.
    expect(bibliographyKeys(source).map(entry => entry.key)).toEqual(["real"]);
  });
  test("adds a package when its only declaration follows a real TeX comment after an escaped slash", () => {
    // Given a comment after the escaped backslash command.
    const source = "\\documentclass{article}\n\\\\% \\usepackage{amssymb}\n\\begin{document}";
    // When package requirements are resolved, then the commented declaration is not trusted.
    expect(packageEdit(source, "amssymb")?.insert).toBe("\\usepackage{amssymb}\n");
  });
});
