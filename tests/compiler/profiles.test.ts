import { test, expect } from "bun:test";
import { FileEntrySchema, IdSchema } from "@quire/contracts";
import { build } from "../../workers/compiler/build";
import { sourceFixture, settings } from "./fixtures";
import { pdfText } from "./pdf-text";
import { retain } from "./evidence";

test("T07 uses local class and package files without changing host search paths", async () => {
  // Given uploaded class/package sources referenced through the snapshot.
  const fixture = sourceFixture("\\documentclass{owned}\\usepackage{ownedstyle}\\begin{document}\\ownedtext\\end{document}", {
    "owned.cls": "\\NeedsTeXFormat{LaTeX2e}\\ProvidesClass{owned}\\LoadClass{article}",
    "ownedstyle.sty": "\\ProvidesPackage{ownedstyle}\\newcommand{\\ownedtext}{Local class and style content.}",
  });
  // When the real compiler resolves its source-only TEXINPUTS.
  const result = await build({ ...fixture, settings });
  const pdf = result.files.get("output.pdf");
  if (!pdf) throw new TypeError(result.log);
  // Then the output contains the command supplied by the local package.
  expect(await pdfText(pdf)).toContain("Local class and style content");
}, 60000);

test("T08 draft skips the actual included PDF image", async () => {
  // Given a real PDF asset and a document that includes it.
  const image = await build({ ...sourceFixture("\\documentclass{article}\\begin{document}OwnedImageContent\\end{document}"), settings });
  const asset = image.files.get("output.pdf");
  if (!asset) throw new TypeError(image.log);
  const fixture = sourceFixture("\\documentclass{article}\\usepackage{graphicx}\\begin{document}Before\\includegraphics[width=3cm]{asset.pdf}After\\end{document}");
  const blob = await fixture.blobs.put(asset);
  const file = FileEntrySchema.parse({ id: IdSchema.parse(crypto.randomUUID()), path: "asset.pdf", kind: "file",
    mime: "application/pdf", blob, bytes: asset.length, editable: false, version: { revision: 0, epoch: 0 }, link: null });
  // When the draft setting reaches real latexmk.
  const compiled = await build({ ...fixture, files: [...fixture.files, file], settings: { ...settings, draft: true } });
  const pdf = compiled.files.get("output.pdf");
  if (!pdf) throw new TypeError(compiled.log);
  // Then the image content is absent and the source text remains.
  const text = await pdfText(pdf);
  expect(text).toContain("Before");
  expect(text).not.toContain("OwnedImageContent");
}, 60000);

test("T18 default shell escape is disabled while sandboxed latexmkrc executes custom rules", async () => {
  // Given executable project configuration and a TeX shell-escape attempt.
  const fixture = sourceFixture("\\documentclass{article}\\begin{document}\\immediate\\write18{touch /work/tex-escaped}Default no shell.\\end{document}", {
    "latexmkrc": 'open(my $f, ">", "/work/rc-ran") or die $!; print $f "custom rule inside jail"; close($f);',
  });
  // When latexmk reads the project rc inside the same confinement.
  const result = await build({ ...fixture, settings });
  // Then the custom rc executes only in the jail and TeX's shell escape stays disabled.
  expect(result.success, result.log).toBe(true);
  expect(result.files.has("rc-ran")).toBe(true);
  expect(result.files.has("tex-escaped")).toBe(false);
}, 60000);

test("T18 dot latexmkrc takes actual latexmk precedence over latexmkrc", async () => {
  // Given both project rc names with observably different effects.
  const fixture = sourceFixture("\\documentclass{article}\\begin{document}Configuration precedence.\\end{document}", {
    "latexmkrc": 'die "lower precedence rc must not run";',
    ".latexmkrc": 'open(my $f, ">", "/work/dot-rc-proof") or die $!; print $f "dot"; close($f);',
  });
  // When the installed compiler resolves project configuration after system configuration.
  const result = await build({ ...fixture, settings });
  // Then only the preferred project rc has executed.
  expect(result.success, result.log).toBe(true);
  expect(new TextDecoder().decode(result.files.get("dot-rc-proof"))).toBe("dot");
}, 60000);

test("T18 renders real two and three dimensional PGF plots", async () => {
  // Given actual PGF plot source.
  const fixture = sourceFixture(`\\documentclass{article}\\usepackage{pgfplots}
\\pgfplotsset{compat=1.18}\\begin{document}
\\begin{tikzpicture}\\begin{axis}\\addplot {x*x};\\end{axis}\\end{tikzpicture}
\\begin{tikzpicture}\\begin{axis}\\addplot3[surf,domain=-1:1,samples=5] {x*y};\\end{axis}\\end{tikzpicture}
\\end{document}`);
  // When the installed PGF package compiles both plots.
  const result = await build({ ...fixture, settings });
  // Then actual PDF drawing data is produced successfully.
  expect(result.success, result.log).toBe(true);
  expect(result.files.get("output.pdf")?.length).toBeGreaterThan(10000);
}, 60000);

for (const stopOnFirstError of [true, false]) {
  test(`T08 ${stopOnFirstError ? "stops" : "retains partial PDF"} when TeX reports a real error`, async () => {
    // Given a source that produces an actual undefined-command error.
    const fixture = sourceFixture("\\documentclass{article}\\begin{document}Before.\\unknownOwnedCommand After.\\end{document}");
    // When the requested error policy reaches the real engine.
    const result = await build({ ...fixture, settings: { ...settings, stopOnFirstError } });
    // Then no mode claims success, but continue mode retains its partial PDF.
    expect(result.success).toBe(false);
    expect(result.files.has("output.pdf")).toBe(!stopOnFirstError);
  }, 60000);
}

for (const engine of ["xelatex", "lualatex"] as const) {
  test(`T07 ${engine} uses an uploaded font and preserves Unicode text`, async () => {
    // Given bytes from an installed public font copied as a project-owned asset.
    const font = await Bun.file("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf").bytes();
    const fixture = sourceFixture("\\documentclass{article}\\usepackage{fontspec}\\setmainfont[Path=/src/]{uploaded.ttf}\\begin{document}Xin chào, đại học.\\end{document}");
    const blob = await fixture.blobs.put(font);
    const file = FileEntrySchema.parse({ id: crypto.randomUUID(), path: "uploaded.ttf", kind: "file",
      mime: "font/ttf", blob, bytes: font.length, editable: false, version: { revision: 0, epoch: 0 }, link: null });
    // When the real Unicode-capable engine reads only the snapshot font.
    const result = await build({ ...fixture, files: [...fixture.files, file], settings: { ...settings, engine } });
    const pdf = result.files.get("output.pdf");
    if (!pdf) throw new TypeError(result.log);
    // Then extracted text retains its actual Unicode characters.
    expect(result.success, result.log).toBe(true);
    expect(await pdfText(pdf)).toContain("Xin chào, đại học");
    await retain(`uploaded-font-${engine}.pdf`, pdf);
  }, 90000);
}
