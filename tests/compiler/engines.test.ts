import { test, expect } from "bun:test";
import { build } from "../../workers/compiler/build";
import { sourceFixture, settings } from "./fixtures";
import { pdfText } from "./pdf-text";
import { retain } from "./evidence";

for (const engine of ["pdflatex", "latex", "xelatex", "lualatex", "plain"] as const) {
  test(`T07 compiles actual ${engine} into a readable PDF`, async () => {
    // Given a real source document.
    const fixture = sourceFixture(engine === "plain" ? "Real plain text\\bye" :
      "\\documentclass{article}\\begin{document}Real engine text\\end{document}");
    // When latexmk executes inside the real resource-contained namespace.
    const result = await build({ ...fixture, settings: { ...settings, engine } });
    // Then a real PDF (and DVI for LaTeX) is retained.
    expect(result.success, result.log).toBe(true);
    const pdf = result.files.get("output.pdf");
    if (!pdf) throw new TypeError("PDF missing");
    expect(await pdfText(pdf)).toContain(engine === "plain" ? "Real plain text" : "Real engine text");
    await retain(`${engine}.pdf`, pdf);
    if (engine === "latex") expect(result.files.has("output.dvi")).toBe(true);
  }, 60000);
}

for (const bibliography of ["bibtex", "biber"] as const) {
  test(`T07 resolves actual ${bibliography} bibliography content`, async () => {
    // Given one genuinely cited record and the engine's normal bibliography workflow.
    const fixture = sourceFixture(bibliography === "bibtex" ?
      "\\documentclass{article}\\begin{document}A citation\\cite{owned}.\\bibliographystyle{plain}\\bibliography{refs}\\end{document}" :
      "\\documentclass{article}\\usepackage[backend=biber]{biblatex}\\addbibresource{refs.bib}\\begin{document}A citation\\cite{owned}.\\printbibliography\\end{document}",
    { "refs.bib": "@book{owned,author={Jane Author},title={Actual Bibliography Title},year={2025},publisher={Fixture Press}}" });
    // When latexmk performs real reruns inside isolation.
    const result = await build({ ...fixture, settings });
    // Then the generated bibliography is present in the PDF, not an unresolved placeholder.
    expect(result.success, result.log).toBe(true);
    expect(result.files.has("output.bbl")).toBe(true);
    const pdf = result.files.get("output.pdf");
    if (!pdf) throw new TypeError("PDF missing");
    expect(await pdfText(pdf)).toContain("Actual Bibliography Title");
  }, 60000);
}
