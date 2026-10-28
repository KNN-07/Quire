import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { probeImage, compileFixture } from "../../../services/operations/environments/probe";
import { runCommand } from "../../../services/operations/environments/process";
import { ImageSchema } from "../../../services/operations/environments/model";

const evidence = join(import.meta.dir,"../../../docs/evidence/p2o-environments");
test("executes real pinned engine, helper and confinement profiles before advertising availability", async () => {
  // Given: the independently built owned image, never host PATH discovery.
  const inspect = await runCommand(["docker","image","inspect","quire-p2o-environments:st_01a17c2c","--format","{{.Id}}"], { seconds: 10 });
  expect(inspect.code).toBe(0);
  const image = ImageSchema.parse(process.env["QUIRE_TEST_ENVIRONMENT_IMAGE"] ?? inspect.stdout.trim());
  await mkdir(evidence,{recursive:true});
  // When: each profile executes its complete real fixture inventory serially.
  for (const profile of ["default","restricted","knitr"] as const) {
    const report = await probeImage(image,profile);
    await writeFile(join(evidence,`${profile}-report.json`),JSON.stringify(report,null,2));
    // Then: actual engine/helper content, artifacts and confinement all passed.
    expect(report.release).toBe("2025");
    expect(report.checks.filter(check => check.code !== 0)).toEqual([]);
    expect(report.available).toBe(true);
  }
  const tagged = await compileFixture(image,{fixture:"tagged",profile:"default",engine:"lualatex"});
  await writeFile(join(evidence,"tagged.log"),tagged.log);
  expect(tagged.code).toBe(0);
  const pdf = tagged.files.get("output.pdf");
  if (!pdf) throw new TypeError("Tagged fixture returned no PDF");
  await writeFile(join(evidence,"tagged.pdf"),pdf);
  const engine = await compileFixture(image,{fixture:"engines",profile:"default",engine:"pdflatex"});
  const plain = engine.files.get("output.pdf");
  if (!plain) throw new TypeError("Engine fixture returned no PDF");
  await writeFile(join(evidence,"engine.pdf"),plain);
  await writeFile(join(evidence,"engine.txt"),engine.text);
},900000);
