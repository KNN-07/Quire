import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { EnvironmentSchema, IdSchema, OperationSchema } from "@quire/contracts";
import { referenceBlob } from "@quire/runtime";
import { fixtureIds } from "../../fixtures/foundation";
import { environmentFixture } from "./harness";
import { verifiedReport } from "./image";
import { profileInput } from "./input";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { saveEnvironment, resolveEnvironment } from "../../../services/operations/environments/registry";
import { runProfile } from "../../../services/operations/environments/execution";
import { runCommand } from "../../../services/operations/environments/process";
import { stopEnvironmentBuilds } from "../../../services/operations/environments";
import { terminalOperation } from "./events";

test("rejects an unconfigured mirror before a build starts",async()=>{
  // Given: an authenticated operator.
  await using fixture = await environmentFixture();
  const operator = await fixture.login();
  // When: it submits a forbidden network destination.
  const response = await operator.write("/api/admin/environments/build",{baseId:fixtureIds.environment,packageList:[],fontUploads:[],mirror:"https://127.0.0.1/"});
  // Then: no provisioning command is admitted.
  expect(response.status).toBe(422);
},180000);
test("rejects duplicate font IDs before admitting build work",async()=>{
  // Given: an authenticated operator and a repeated upload identifier.
  await using fixture=await environmentFixture();
  const operator=await fixture.login();
  const id=crypto.randomUUID();
  // When: the duplicate build input crosses the operator boundary.
  const response=await operator.write("/api/admin/environments/build",{
    baseId:fixtureIds.environment,packageList:[],fontUploads:[id,id],mirror:"https://archive.ubuntu.com/ubuntu/"});
  // Then: it is rejected rather than queued with ambiguous inputs.
  expect(response.status).toBe(422);
  expect(z.object({error:z.object({code:z.string()})}).parse(await response.json()).error.code).toBe("BUILD_INPUT_LIMIT");
},180000);
test("builds an isolated uploaded-font image and downloads its actual receipt",async()=>{
  // Given: a verified Docker base and an owned uploaded Lato font absent from it.
  await using fixture = await environmentFixture();
  const report = await verifiedReport();
  const base = manifestFromProbe({id:crypto.randomUUID(),label:"Font base",report});
  const operator = await fixture.login();
  await saveEnvironment(fixture.context,{manifest:base,report,actor:operator.actor});
  const bytes = new Uint8Array(await readFile("/usr/share/fonts/truetype/lato/Lato-Regular.ttf"));
  const blob = await fixture.runtime.blobs.put(bytes);
  const fontId = IdSchema.parse(crypto.randomUUID());
  await fixture.runtime.uow.run(async tx=>{
    await referenceBlob(tx,{digest:blob,bytes:bytes.length},fixture.runtime.clock);
    await tx.run("UPDATE projects SET owner_id=? WHERE id=?",[fixtureIds.operator,fixtureIds.project]);
    await tx.run(`INSERT INTO files(id,branch_id,path,kind,mime,blob,bytes,editable,created_at,updated_at)
      VALUES(?,?,'Lato-Regular.ttf','file','font/ttf',?,?,0,?,?)`,
      [fontId,fixtureIds.branch,blob,bytes.length,fixture.runtime.clock.now(),fixture.runtime.clock.now()]);
  });
  const key = crypto.randomUUID();
  const request = {baseId:base.id,packageList:[],fontUploads:[fontId],mirror:"https://archive.ubuntu.com/ubuntu/"};
  let builtImage: string | undefined;
  let operationId: string | undefined;
  await using terminal=terminalOperation(fixture.runtime);
  try {
    // When: the real operator build is queued and observed through its subscribed terminal event.
    const response = await operator.write("/api/admin/environments/build",request,key);
    expect(response.status).toBe(202);
    const queued = z.object({data:OperationSchema}).parse(await response.json()).data;
    operationId = queued.id;
    expect(queued.status).toBe("queued");
    const activeReplay=await operator.write("/api/admin/environments/build",request,key);
    expect(z.object({data:OperationSchema}).parse(await activeReplay.json()).data.id).toBe(queued.id);
    expect(await terminal.promise).toBe(queued.id);
    const operation=z.object({data:OperationSchema}).parse(await(await operator.get(`/api/operations/${queued.id}`)).json()).data;
    await writeFile(join(import.meta.dir,"../../../docs/evidence/p2o-environments/font-operation.json"),JSON.stringify(operation,null,2));
    const result = z.object({environmentId:IdSchema,image:z.string()}).parse(operation.result);
    builtImage = result.image;
    // Then: the image contains the parsed uploaded font and compiles with it.
    expect(operation.status).toBe("succeeded");
    const environment = await resolveEnvironment(fixture.context,result.environmentId);
    expect(environment.packagesDigest).not.toBe(base.packagesDigest);
    const input = await profileInput(fixture.context,environment,{"main.tex":String.raw`\documentclass{article}
\usepackage{fontspec}\setmainfont{Lato}\begin{document}Uploaded Lato font evidence.\end{document}`});
    const compiled = await runProfile({...input,settings:{...input.settings,engine:"xelatex"}});
    expect(compiled.success).toBe(true);
    const pdf = compiled.files.get("output.pdf");
    if (!pdf) throw new TypeError("Custom font image returned no PDF");
    const evidence = join(import.meta.dir,"../../../docs/evidence/p2o-environments");
    await mkdir(evidence,{recursive:true});
    await writeFile(join(evidence,"uploaded-font.pdf"),pdf);
    const fonts = await runCommand(["pdffonts",join(evidence,"uploaded-font.pdf")],{seconds:10});
    expect(fonts.code).toBe(0);
    expect(fonts.stdout).toContain("Lato");
    await writeFile(join(evidence,"uploaded-fonts.txt"),fonts.stdout);
    const operationRead = await operator.get(`/api/operations/${operation.id}`);
    expect(operationRead.status).toBe(200);
    const download = await operator.get(`/api/operations/${operation.id}/download`);
    expect(download.status).toBe(200);
    const receipt = z.object({manifest:EnvironmentSchema}).parse(await download.json());
    expect(receipt.manifest.id).toBe(environment.id);
    await writeFile(join(evidence,"build-receipt.json"),JSON.stringify(operation,null,2));
    const replay = await operator.write("/api/admin/environments/build",request,key);
    expect(z.object({data:OperationSchema}).parse(await replay.json()).data.id).toBe(operation.id);
  } finally {
    await stopEnvironmentBuilds(fixture.runtime);
    if (operationId) {
      const cleanup = await runCommand(["docker","image","rm",`quire-environment-build:${operationId}`],{seconds:30});
      expect(cleanup.code===0 || cleanup.stderr.includes("No such image")).toBe(true);
    } else if (builtImage) {
      const cleanup = await runCommand(["docker","image","rm",builtImage],{seconds:30});
      expect(cleanup.code).toBe(0);
    }
  }
},300000);
