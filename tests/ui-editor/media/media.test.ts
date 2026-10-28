import { expect, test } from "bun:test";
import { assertGraphicBytes, clipboardImage, figureCommand, figurePath } from "../../../apps/web/src/features/editor/visual/media";
import { packageEdit } from "../../../apps/web/src/features/editor/tools/insertion";

test("figure paths cannot inject TeX, escape the project or select non-compilable formats", () => {
  for (const path of ["../x.png", "/x.png", "images/../../x.png", "a}evil.png", "a%20.png", "a\\x.png", "a.svg", "a.webp", "a.gif"]) {
    expect(() => figurePath(path)).toThrow();
  }
  for (const path of ["images/diagram-2.png", "plot.v2.jpeg", "figures/chart.pdf", "legacy.eps"]) expect(figurePath(path)).toBe(path);
  expect(figureCommand("images/plot.png", "caption", "fig:plot", "0.75"))
    .toContain("\\includegraphics[width=0.75\\linewidth]{images/plot.png}");
  expect(() => figureCommand("plot.png", "", "x}\\input{bad}", "0.8")).toThrow();
  expect(() => figureCommand("plot.png", "", "", "0")).toThrow();
  expect(() => figureCommand("plot.png", "", "", "2")).toThrow();
});

test("media package insertion ignores macro examples and recognizes real preamble declarations", () => {
  const source = "\\documentclass{article}\n\\newcommand{\\example}{\\usepackage{graphicx}\\begin{document}}\n\\begin{document}\n";
  const edit = packageEdit(source, "graphicx");
  expect(edit?.from).toBe(source.lastIndexOf("\\begin{document}"));
  expect(edit?.insert).toBe("\\usepackage{graphicx}\n");
  expect(packageEdit("\\RequirePackage{graphicx}\n\\begin{document}", "graphicx")).toBeNull();
  expect(packageEdit("\\\\usepackage{graphicx}\n\\begin{document}", "graphicx")?.insert).toBe("\\usepackage{graphicx}\n");
});

test("image entry routes require bytes matching the chosen compilation extension", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(() => assertGraphicBytes("image.png", png)).not.toThrow();
  expect(() => assertGraphicBytes("image.jpg", png)).toThrow();
  expect(() => assertGraphicBytes("image.png", new TextEncoder().encode("<html>Not an image"))).toThrow();
  expect(() => assertGraphicBytes("chart.pdf", new TextEncoder().encode("%PDF-1.7"))).not.toThrow();
  expect(() => assertGraphicBytes("chart.eps", new TextEncoder().encode("%!PS-Adobe-3.0 EPSF-3.0"))).not.toThrow();
  expect(() => assertGraphicBytes("chart.pdf", new TextEncoder().encode("%!PS-Adobe-3.0"))).toThrow();
});

test("clipboard file multiplicity and unsupported formats reject instead of claiming success", () => {
  const file = new File(["bytes"], "one.jpeg", { type: "image/jpeg" });
  const item = { kind: "file", getAsFile: () => file };
  // DataTransfer is browser-owned; these boundary inputs exercise selection only,
  // while decoding/upload/authority run with real browser APIs in browser.test.ts.
  const transfer = (items: Pick<DataTransferItem, "kind" | "getAsFile">[]) => ({ items });
  expect(clipboardImage(transfer([item]))).toBe(file);
  expect(clipboardImage(transfer([]))).toBeNull();
  expect(() => clipboardImage(transfer([item, item]))).toThrow();
  expect(() => clipboardImage(transfer([{ kind: "file", getAsFile: () => new File(["x"], "x.svg", { type: "image/svg+xml" }) }]))).toThrow();
});
