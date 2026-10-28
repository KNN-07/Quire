import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixtureIds } from "../../fixtures/foundation";
import { parseDiagnostics } from "../../../services/compiler/diagnostics";
import { runProfile } from "../../../services/operations/environments/execution";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { environmentFixture } from "./harness";
import { verifiedReport } from "./image";
import { profileInput } from "./input";

test("actual Docker TeX reports a malformed selected draft with a linked line diagnostic",async()=>{
  // Given: an existing selected TeX main whose documentclass was temporarily misspelled.
  await using fixture=await environmentFixture();
  const environment=manifestFromProbe({id:crypto.randomUUID(),label:"Invalid Docker draft",report:await verifiedReport()});
  const input=await profileInput(fixture.context,environment,{
    "main.tex":"\\documentclas{article}\n\\begin{document}Draft\\end{document}",
  });
  // When: the immutable draft reaches the actual confined compiler.
  const result=await runProfile(input);
  // Then: this is a compiler failure linked to source, not a service syntax rejection.
  const diagnostics=parseDiagnostics({jobId:fixtureIds.snapshot,files:input.files,log:result.log});
  expect(result.success).toBe(false);
  expect(result.code).not.toBe(0);
  expect(diagnostics.some(item=>item.severity==="error" && item.fileId===fixtureIds.mainFile && item.line===1)).toBe(true);
  await writeFile(join(import.meta.dir,"../../../docs/evidence/p2o-environments/docker-invalid-draft.json"),
    JSON.stringify({code:result.code,success:result.success,diagnostics,log:result.log},null,2));
},180000);
