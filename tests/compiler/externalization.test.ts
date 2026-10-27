import { test, expect } from "bun:test";
import { build } from "../../workers/compiler/build";
import { sourceFixture, settings } from "./fixtures";

test("T18 explicitly configured TikZ externalization executes entirely inside confinement", async () => {
  // Given project-local executable configuration that explicitly enables the isolated helper.
  const fixture = sourceFixture(`\\documentclass{article}\\usepackage{tikz}
\\usetikzlibrary{external}\\tikzexternalize[prefix=/work/tikz/]
\\tikzset{external/system call={pdflatex -shell-escape -halt-on-error -interaction=batchmode -output-directory=/work -jobname "\\image" "\\string\\def\\string\\tikzexternalrealjob{output}\\string\\input{/src/main.tex}"}}
\\begin{document}\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}\\end{document}`, {
    "latexmkrc": `system('mkdir','-p','/work/tikz') == 0 or die "cannot create generated directory";
$pdflatex = 'pdflatex -shell-escape -interaction=nonstopmode -halt-on-error -file-line-error -synctex=1 -recorder -output-directory=/work -jobname=output %S';`,
  });
  // When real latexmk and TikZ execute the explicitly configured child compiler.
  const result = await build({ ...fixture, settings });
  // Then both the main PDF and the actually externalized figure exist.
  expect(result.success, result.log).toBe(true);
  expect(result.files.has("tikz/output-figure0.pdf")).toBe(true);
}, 60000);
