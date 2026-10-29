import { expect, test } from "bun:test";
import { FileEntrySchema } from "@quire/contracts";
import { parseDiagnostics } from "../../services/compiler/diagnostics";
import { fixtureIds } from "../fixtures/foundation";

const file = FileEntrySchema.parse({ id: fixtureIds.mainFile, path: "sections/snippet.inc",
  kind: "file", mime: "text/plain", blob: null, bytes: 0, editable: true,
  version: { epoch: 0, revision: 0 }, link: null });

test("ignores PDF metadata timestamps when parsing a successful compiler log", () => {
  // Given: actual pdfinfo-style metadata appended to a successful tool log.
  const log = "Output written on output.pdf (1 page).\nCreationDate:    Tue Oct 27 01:13:37 2026 UTC\nModDate:         Tue Oct 27 01:13:37 2026 UTC\n";
  // When: the complete log is classified.
  const diagnostics = parseDiagnostics({ jobId: fixtureIds.snapshot, log, files: [file] });
  // Then: timestamp colons cannot manufacture source errors.
  expect(diagnostics).toEqual([]);
});

test("links a real error in a known non-TeX-extension source file", () => {
  // Given: a project input file with a valid nonstandard extension.
  const log = "Compiler output\n/src/sections/snippet.inc:12: Undefined control sequence.\n";
  // When: the located source error is parsed.
  const diagnostics = parseDiagnostics({ jobId: fixtureIds.snapshot, log, files: [file] });
  // Then: its identity, line and raw span remain actionable.
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatchObject({ severity: "error", fileId: file.id, line: 12, message: "Undefined control sequence." });
  const diagnostic = diagnostics[0];
  if (!diagnostic) throw new TypeError("Expected source diagnostic");
  expect(log.slice(diagnostic.rawStart, diagnostic.rawEnd)).toBe("/src/sections/snippet.inc:12: Undefined control sequence.");
});

test("classifies located package warnings without promoting them to errors", () => {
  // Given: an installed package's file-line warning.
  const log = "/usr/share/texlive/texmf-dist/tex/latex/example.sty:5: Package Example Warning: Missing option.\n";
  // When: no project file corresponds to the installed package.
  const diagnostics = parseDiagnostics({ jobId: fixtureIds.snapshot, log, files: [] });
  // Then: location survives but severity stays a warning.
  expect(diagnostics[0]).toMatchObject({ severity: "warning", fileId: null, line: 5 });
});

test("classifies located box warnings as typesetting diagnostics", () => {
  // Given: a source-located TeX box warning.
  const log = "/src/sections/snippet.inc:8: Overfull \\hbox (2.0pt too wide)\n";
  // When: the log is parsed.
  const diagnostics = parseDiagnostics({ jobId: fixtureIds.snapshot, log, files: [file] });
  // Then: typesetting warnings remain distinct from compiler errors.
  expect(diagnostics[0]).toMatchObject({ severity: "typesetting", fileId: file.id, line: 8 });
});

test("final latexmk pass replaces transient warnings while preserving raw spans and errors", () => {
  // Given: reruns resolved an earlier citation/box warning, but a real error and a final warning remain.
  const log = [
    "Run number 1 of rule 'pdflatex'",
    "(/src/sections/snippet.inc",
    "LaTeX Warning: Citation `first-pass-only' undefined.",
    "Overfull \\hbox (3.0pt too wide)",
    "/src/sections/snippet.inc:12: Undefined control sequence.",
    ")",
    "Run number 2 of rule 'pdflatex'",
    "(/src/sections/snippet.inc",
    "LaTeX Warning: Citation `still-missing' undefined.",
    "Underfull \\hbox (badness 1000)",
    ")",
  ].join("\n");
  // When: the complete raw transcript is summarized.
  const diagnostics = parseDiagnostics({ jobId: fixtureIds.snapshot, log, files: [file] });
  // Then: earlier errors are retained; warning/type-setting spans belong to the final TeX pass.
  expect(diagnostics.map(item => item.severity)).toEqual(["error", "warning", "typesetting"]);
  expect(diagnostics.map(item => item.message)).toEqual([
    "Undefined control sequence.", "LaTeX Warning: Citation `still-missing' undefined.", "Underfull \\hbox (badness 1000)",
  ]);
  for (const item of diagnostics.slice(1)) {
    expect(item.fileId).toBe(file.id);
    expect(log.slice(item.rawStart, item.rawEnd)).toBe(item.message);
  }
});

test("final latexmk clean pass does not suppress single-pass or non-latexmk warnings", () => {
  const warning = "LaTeX Warning: Citation `missing' undefined.";
  expect(parseDiagnostics({ jobId: fixtureIds.snapshot, log: warning, files: [] })).toHaveLength(1);
  expect(parseDiagnostics({ jobId: fixtureIds.snapshot,
    log: `Run number 1 of rule 'lualatex'\r\n${warning}\r\n`, files: [] })).toHaveLength(1);
  expect(parseDiagnostics({ jobId: fixtureIds.snapshot, files: [],
    log: `Run number 1 of rule 'lualatex'\r\n${warning}\r\nRun number 2 of rule 'lualatex'\r\nOutput written.\r\n` })).toEqual([]);
});
