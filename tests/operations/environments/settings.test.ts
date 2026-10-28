import { expect, test } from "bun:test";
import { environmentFixture } from "./harness";
import { verifiedReport, ownedImage } from "./image";
import { profileInput } from "./input";
import { manifestFromProbe, compileFixture } from "../../../services/operations/environments/probe";
import { runProfile } from "../../../services/operations/environments/execution";

test("continues to later source when stopOnFirstError is disabled",async()=>{
  // Given: an actual error followed by an observable machine sentinel.
  await using fixture = await environmentFixture();
  const environment = manifestFromProbe({id:crypto.randomUUID(),label:"Settings",report:await verifiedReport()});
  const input = await profileInput(fixture.context,environment,{"main.tex":String.raw`\documentclass{article}
\begin{document}\undefinedcommand\typeout{QUIRE_AFTER_ERROR}Continued.\end{document}`});
  const stopped = await runProfile(input);
  // When: the same source is compiled without stopping on its first error.
  const continued = await runProfile({...input,settings:{...input.settings,stopOnFirstError:false}});
  // Then: only the continued compile reaches the later sentinel; neither is successful.
  expect(stopped.log).not.toMatch(/^QUIRE_AFTER_ERROR$/m);
  expect(continued.log).toMatch(/^QUIRE_AFTER_ERROR$/m);
  expect(stopped.success).toBe(false); expect(continued.success).toBe(false);
},180000);
test("omits actual included PDF content when draft image skipping is enabled",async()=>{
  // Given: a genuine generated PDF embedded as a project asset.
  await using fixture = await environmentFixture();
  const figure = await compileFixture(await ownedImage(),{fixture:"engines",profile:"default",engine:"pdflatex"});
  const pdf = figure.files.get("output.pdf");
  if (!pdf) throw new TypeError("Expected real figure PDF");
  const environment = manifestFromProbe({id:crypto.randomUUID(),label:"Draft",report:await verifiedReport()});
  const input = await profileInput(fixture.context,environment,{"main.tex":String.raw`\documentclass{article}
\usepackage{graphicx}\begin{document}Draft behavior.\includegraphics[width=5cm]{figure.pdf}\end{document}`,"figure.pdf":pdf});
  const full = await runProfile(input);
  // When: the same immutable source is compiled with draft enabled.
  const draft = await runProfile({...input,settings:{...input.settings,draft:true}});
  // Then: the actual included PDF text is absent from the draft PDF.
  const decoder = new TextDecoder();
  expect(full.success).toBe(true); expect(draft.success).toBe(true);
  expect(decoder.decode(full.files.get("output.txt"))).toContain("Quire real engine");
  expect(decoder.decode(draft.files.get("output.txt"))).not.toContain("Quire real engine");
},180000);
test("executes the preferred project latexmkrc inside confinement without changing the selected engine",async()=>{
  // Given: conflicting rc files and a dot-rc that creates a generated artifact.
  await using fixture = await environmentFixture();
  const environment = manifestFromProbe({id:crypto.randomUUID(),label:"Project rules",report:await verifiedReport()});
  const input = await profileInput(fixture.context,environment,{
    "main.tex":String.raw`\documentclass{article}\begin{document}Confined project rule.\end{document}`,
    "latexmkrc":'die "lower-precedence rc must not execute";',
    ".latexmkrc":'$pdf_mode=4; open(my $f,">","/work/rc-proof") or die $!; print $f "DOT"; close($f);',
  });
  // When: the selected pdfLaTeX profile executes its real latexmk configuration.
  const result = await runProfile(input);
  // Then: project precedence and selected engine are both honored inside the job.
  expect(result.success).toBe(true);
  expect(new TextDecoder().decode(result.files.get("rc-proof"))).toBe("DOT");
  expect(result.log).toContain("This is pdfTeX");
  expect(result.files.has("main.tex")).toBe(false);
  expect(result.files.has(".latexmkrc")).toBe(false);
},180000);
test("runs an uploaded Rnw source beside the editable TeX main without changing original inputs",async()=>{
  // Given: the actually probed knitr profile and a TeX main selected by the editor.
  await using fixture = await environmentFixture();
  const environment = manifestFromProbe({id:crypto.randomUUID(),label:"Actual knitr main",report:await verifiedReport("knitr")});
  const input = await profileInput(fixture.context,environment,{
    "main.tex":String.raw`\documentclass{article}\begin{document}Editor main.\end{document}`,
    "main.Rnw":String.raw`\documentclass{article}
\begin{document}
<<calculation,echo=FALSE,results='asis'>>=
cat("Computed result:",sum(1:10))
@
\end{document}`,
  });
  // When: this actual immutable source set is run through the knitr profile.
  const result = await runProfile(input);
  // Then: R produced the PDF text and no uploaded source is returned as a generated mutation.
  expect(result.success).toBe(true);
  expect(new TextDecoder().decode(result.files.get("output.txt"))).toContain("Computed result: 55");
  expect(result.files.has("main.tex")).toBe(false);
  expect(result.files.has("main.Rnw")).toBe(false);
},180000);
