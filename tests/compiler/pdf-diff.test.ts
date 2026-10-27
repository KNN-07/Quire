import { test, expect } from "bun:test";
import { build } from "../../workers/compiler/build";
import { renderedDifference } from "../../workers/compiler/pdf-diff";
import { sourceFixture, settings } from "./fixtures";
import { pdfText } from "./pdf-text";
import { retain } from "./evidence";

test("T10 compares real rendered pages and emits a downloadable comparison PDF", async () => {
  // Given two actually compiled snapshots with a changed number and moved paragraph.
  const from = await build({ ...sourceFixture("\\documentclass{article}\\begin{document}Result 42.\\par Moved paragraph.\\end{document}"), settings });
  const to = await build({ ...sourceFixture("\\documentclass{article}\\begin{document}Result 43.\\vspace{2cm}\\par Moved paragraph.\\end{document}"), settings });
  const a = from.files.get("output.pdf"), b = to.files.get("output.pdf");
  if (!a || !b) throw new TypeError(`${from.log}\n${to.log}`);
  // When the actual page bitmaps are compared.
  const diff = await renderedDifference({ from: a, to: b, mode: "side-by-side" });
  // Then a visual region and both real document contents are in the generated PDF.
  expect(diff.regions.length).toBeGreaterThan(0);
  expect(diff.regions[0]?.label).toBe("visual difference");
  expect([...diff.images.keys()].filter((name) => name.endsWith(".png"))).toHaveLength(2);
  const text = await pdfText(diff.pdf);
  expect(text).toContain("Result 42");
  expect(text).toContain("Result 43");
  await retain("side-by-side.pdf", diff.pdf);
  await retain("side-by-side.png", diff.preview);
  await retain("regions.json", new TextEncoder().encode(JSON.stringify(diff.regions)));
}, 60000);

test("T10 identical PDFs produce no visual changes in overlay mode", async () => {
  // Given one real PDF.
  const compiled = await build({ ...sourceFixture("\\documentclass{article}\\begin{document}Identical.\\end{document}"), settings });
  const pdf = compiled.files.get("output.pdf");
  if (!pdf) throw new TypeError(compiled.log);
  // When it is compared to itself.
  const diff = await renderedDifference({ from: pdf, to: pdf, mode: "overlay" });
  // Then pixel changes are empty while the comparison PDF is still genuine.
  expect(diff.regions).toEqual([]);
  expect(await pdfText(diff.pdf)).toContain("Identical");
  await retain("overlay.pdf", diff.pdf);
  await retain("overlay.png", diff.preview);
}, 60000);

test("T10 includes added pages when snapshot page counts differ", async () => {
  // Given real PDFs with one and two pages.
  const from = await build({ ...sourceFixture("\\documentclass{article}\\begin{document}First page.\\end{document}"), settings });
  const to = await build({ ...sourceFixture("\\documentclass{article}\\begin{document}First page.\\newpage Added page.\\end{document}"), settings });
  const a = from.files.get("output.pdf"), b = to.files.get("output.pdf");
  if (!a || !b) throw new TypeError(`${from.log}\n${to.log}`);
  // When actual renders are compared without assuming equal page counts.
  const diff = await renderedDifference({ from: a, to: b, mode: "side-by-side" });
  // Then the extra page is a real visual region and remains in the comparison PDF.
  expect(diff.regions.some((region) => region.page === 2)).toBe(true);
  expect(await pdfText(diff.pdf)).toContain("Added page");
}, 60000);
