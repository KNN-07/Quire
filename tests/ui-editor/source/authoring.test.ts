import { describe, expect, test } from "bun:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { codeCheck } from "../../../apps/web/src/features/editor/source/check";
import { texCompletion } from "../../../apps/web/src/features/editor/source/completion";
import { lineOffset, maskedTex, sourceOffset, sourceSelection, texIndex } from "../../../apps/web/src/features/editor/source/tex";
import { searchScope, selectionScope, setSearchScope, sourceQuery } from "../../../apps/web/src/features/editor/source/search";

describe("lossless TeX authoring", () => {
  test("indexes nested current-file headings and actual labels while excluding comments and verbatim", () => {
    // Given source with nested arguments, short titles, comments and literal environments.
    const source = "% \\section{Hidden}\n\\section[Short]{A {nested} title}\n\\label{sec:真实}\n\\begin{verbatim}\n\\section{Literal}\n\\end{verbatim}\n\\subsection*{Methods}";
    // When source is indexed without expanding includes.
    const index = texIndex(source);
    // Then only real commands appear at exact source offsets.
    expect(index.headings.map(heading => heading.title)).toEqual(["A {nested} title", "Methods"]);
    expect(index.labels).toEqual(["sec:真实"]);
    expect(source.slice(index.headings[0]?.from, index.headings[0]?.to)).toBe("\\section[Short]{A {nested} title}");
    expect(maskedTex(source).length).toBe(source.length);
  });
  test("completes actual citation and reference keys instead of examples", () => {
    // Given keys parsed from real source text and a bibliography.
    const index = texIndex("\\label{sec:actual}\n@article{Nguyen2026, title={A}}\n@comment{ignore,this}");
    const completion = texCompletion(() => index);
    // When completion runs at reference and citation argument positions.
    const references = "\\ref{sec:";
    const citations = "\\cite{other,Ng";
    const ref = completion(new CompletionContext(EditorState.create({ doc: references }), references.length, true));
    const cite = completion(new CompletionContext(EditorState.create({ doc: citations }), citations.length, true));
    // Then options and replacement start use only those actual keys.
    expect(ref?.options.map(option => option.label)).toEqual(["sec:actual"]);
    expect(cite?.options.map(option => option.label)).toEqual(["Nguyen2026"]);
    expect(cite?.from).toBe(citations.indexOf("Ng"));
  });
  test("completes commands with package hints and environments", () => {
    // Given command and environment prefixes.
    const completion = texCompletion(() => texIndex(""));
    const command = "\\eq";
    const environment = "\\begin{ali";
    // When both completion contexts are queried.
    const commands = completion(new CompletionContext(EditorState.create({ doc: command }), command.length, true));
    const environments = completion(new CompletionContext(EditorState.create({ doc: environment }), environment.length, true));
    // Then maintained syntax snippets name package requirements and matching environments.
    expect(commands?.options.find(option => option.label === "\\eqref")?.detail).toBe("Requires amsmath");
    expect(environments?.options.some(option => option.label === "align")).toBe(true);
  });
  test("suppresses heuristics globally by file and by region", () => {
    // Given malformed TeX inside and outside a suppression region.
    const source = "% quire-check disable braces\n{\n% quire-check enable braces\n}\n}\n\\begin{figure}";
    // When the three supported suppression scopes are applied.
    const regions = codeCheck(source, { enabled: true });
    const file = codeCheck("% quire-check disable-file all\n" + source, { enabled: true });
    const global = codeCheck(source, { enabled: false });
    // Then scoped suppression excludes only covered heuristics.
    expect(regions.map(issue => issue.rule)).toEqual(["braces", "environment"]);
    expect(file).toEqual([]);
    expect(global).toEqual([]);
  });
  test("checks math and repeated words without changing unknown source", () => {
    // Given an unknown macro and malformed math in original bytes.
    const source = "\\unknown{😀}\nText text \\(x";
    // When heuristic checking runs.
    const issues = codeCheck(source, { enabled: true });
    // Then findings retain exact UTF-16 ranges and original source is untouched.
    expect(issues.map(issue => issue.rule)).toEqual(["repeated-word", "math"]);
    expect(source.slice(issues[1]?.from, issues[1]?.to)).toBe("\\(");
    expect(source).toBe("\\unknown{😀}\nText text \\(x");
  });
  test("normalizes selections and diagnostic navigation at non-BMP boundaries", () => {
    // Given a document containing emoji, Vietnamese and Chinese.
    const source = "A😀B\nTiếng Việt 中文";
    // When API selection/line offsets land inside a surrogate pair or beyond the file.
    const selection = sourceSelection(source, { anchor: 2, head: source.length + 12 });
    // Then no command boundary splits a code point.
    expect(selection).toEqual({ anchor: 1, head: source.length });
    expect(sourceOffset(source, 2)).toBe(1);
    expect(lineOffset(source, { line: 1, column: 3 })).toBe(1);
    expect(lineOffset(source, { line: 2, column: 1 })).toBe(5);
  });
  test("combines case regex whole-word and mapped selection search", () => {
    // Given a selected region containing two different case variants.
    let state = EditorState.create({ doc: "cat Cat scatter cat", extensions: [searchScope] });
    state = state.update({ effects: setSearchScope.of(selectionScope(0, 7)) }).state;
    const query = sourceQuery({ search: "c.t", replace: "$&!", regexp: true, wholeWord: true, caseSensitive: false });
    // When an insertion shifts the selection scope and the query is searched.
    state = state.update({ changes: { from: 0, insert: ">>" } }).state;
    const matches = [...{ [Symbol.iterator]: () => query.getCursor(state) }];
    // Then only complete words within the mapped region match.
    expect(matches.map(({ from, to }) => ({ from, to }))).toEqual([{ from: 2, to: 5 }, { from: 6, to: 9 }]);
    const sensitive = sourceQuery({ search: "cat", replace: "", regexp: false, wholeWord: true, caseSensitive: true });
    expect([...{ [Symbol.iterator]: () => sensitive.getCursor(state) }].map(({ from, to }) => ({ from, to }))).toEqual([{ from: 2, to: 5 }]);
  });
  test("marks invalid regular expressions unusable", () => {
    // Given a malformed user query.
    const input = { search: "[", replace: "", regexp: true, wholeWord: false, caseSensitive: false };
    // When the search boundary creates its query.
    const query = sourceQuery(input);
    // Then commands can disable without throwing or changing source.
    expect(query.valid).toBe(false);
  });
});
