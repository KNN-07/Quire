import { test, expect } from "bun:test";
import { build } from "../../workers/compiler/build";
import { sourceFixture, settings } from "./fixtures";
import { retain } from "./evidence";

test("T07 LuaLaTeX produces tagged PDF 2.0 and actual MathML artifacts", async () => {
  // Given the installed LaTeX tagging profile and Lua engine.
  const fixture = sourceFixture(`\\DocumentMetadata{lang=en-US,pdfversion=2.0,testphase={phase-III}}
\\documentclass{article}\\usepackage{unicode-math}
\\tagpdfsetup{math/mathml/luamml/load=true}
\\begin{document}\\section{Accessible structure}
A tagged paragraph with mathematics $x^2+y^2=z^2$.\\end{document}`);
  // When the real installed engine emits and Poppler inspects the PDF.
  const result = await build({ ...fixture, settings: { ...settings, engine: "lualatex" } });
  // Then actual PDF metadata reports tagging and version, without claiming conformance certification.
  expect(result.success, result.log).toBe(true);
  expect(result.log).toMatch(/^Tagged:\s+yes$/m);
  expect(result.log).toMatch(/^PDF version:\s+2\.0$/m);
  const mathml = result.files.get("output-luamml-mathml.html");
  if (!mathml) throw new TypeError("Lua engine did not emit its MathML artifact");
  expect(new TextDecoder().decode(mathml)).toMatch(/<math\b/);
  expect(new TextDecoder().decode(mathml)).toMatch(/<msup\b/);
  const pdf = result.files.get("output.pdf");
  if (!pdf) throw new TypeError(result.log);
  await retain("tagged-lualatex.pdf", pdf);
  await retain("lualatex-mathml.html", mathml);
}, 90000);

test("T07 pdfLaTeX tagging does not falsely advertise automatic Lua MathML output", async () => {
  // Given the same tagging request on the non-Lua engine.
  const fixture = sourceFixture(`\\DocumentMetadata{lang=en-US,pdfversion=2.0,testphase={phase-III}}
\\documentclass{article}\\tagpdfsetup{math/mathml/luamml/load=true}
\\begin{document}A formula $x^2$.\\end{document}`);
  // When the native non-Lua engine executes its supported tagging path.
  const result = await build({ ...fixture, settings });
  // Then tagging remains real but no nonexistent Lua-generated MathML artifact is reported.
  expect(result.success, result.log).toBe(true);
  expect(result.files.has("output-luamml-mathml.html")).toBe(false);
}, 60000);
