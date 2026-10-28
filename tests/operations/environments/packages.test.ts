import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { environmentFixture } from "./harness";
import { verifiedReport } from "./image";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { saveEnvironment } from "../../../services/operations/environments/registry";
import { dockerSandbox } from "../../../workers/compiler/docker";
import { defaultLimits } from "../../../workers/compiler/sandbox";
import { runCommand } from "../../../services/operations/environments/process";
import { stopEnvironmentBuilds } from "../../../services/operations/environments";
import { terminalOperation } from "./events";

test("installs a pinned optional package only through the configured signed public mirror",async()=>{
  // Given: a verified base image and a concrete package version from its archive.
  await using fixture = await environmentFixture();
  const report = await verifiedReport();
  const base = manifestFromProbe({id:crypto.randomUUID(),label:"Package base",report});
  const operator = await fixture.login();
  await saveEnvironment(fixture.context,{manifest:base,report,actor:operator.actor});
  let operationId: string | undefined;
  await using terminal=terminalOperation(fixture.runtime);
  try {
    // When: the operator provisions the pinned optional package in a new image.
    const response = await operator.write("/api/admin/environments/build",{
      baseId:base.id,packageList:["fonts-lato=2.015-1build1"],fontUploads:[],mirror:"https://archive.ubuntu.com/ubuntu/"});
    expect(response.status).toBe(202);
    const queued = z.object({data:OperationSchema}).parse(await response.json()).data;
    operationId=queued.id;
    expect(queued.status).toBe("queued");
    expect(await terminal.promise).toBe(queued.id);
    const operation=z.object({data:OperationSchema}).parse(await(await operator.get(`/api/operations/${queued.id}`)).json()).data;
    expect(operation.status).toBe("succeeded");
    const result = z.object({environmentId:IdSchema,image:z.string(),available:z.literal(true)}).parse(operation.result);
    // Then: the installed package is observed inside the actual probed image.
    const installed = await dockerSandbox({image:result.image,source:join(import.meta.dir,"../../../deploy/compiler/fixtures/engines"),
      limits:defaultLimits,command:["dpkg-query","-W","-f=${Version}","fonts-lato"]});
    expect(installed.code).toBe(0);
    expect(new TextDecoder().decode(installed.stdout)).toBe("2.015-1build1");
    await writeFile(join(import.meta.dir,"../../../docs/evidence/p2o-environments/package-build.json"),
      JSON.stringify({operation,packageVersion:new TextDecoder().decode(installed.stdout)},null,2));
  } finally {
    await stopEnvironmentBuilds(fixture.runtime);
    if (operationId) {
      const cleanup = await runCommand(["docker","image","rm",`quire-environment-build:${operationId}`],{seconds:30});
      expect(cleanup.code===0 || cleanup.stderr.includes("No such image")).toBe(true);
    }
  }
},300000);
test("records a real failed package subprocess without publishing an available environment",async()=>{
  // Given: a valid base and a pinned package version absent from the signed archive.
  await using fixture=await environmentFixture();
  const operator=await fixture.login();
  const report=await verifiedReport();
  const base=manifestFromProbe({id:crypto.randomUUID(),label:"Failed package base",report});
  await saveEnvironment(fixture.context,{manifest:base,report,actor:operator.actor});
  await using terminal=terminalOperation(fixture.runtime);
  let operationId:string|undefined;
  try {
    // When: the actual isolated package installation fails.
    const response=await operator.write("/api/admin/environments/build",{
      baseId:base.id,packageList:["fonts-lato=0.0.0-quire-missing"],fontUploads:[],mirror:"https://archive.ubuntu.com/ubuntu/"});
    expect(response.status).toBe(202);
    const queued=z.object({data:OperationSchema}).parse(await response.json()).data;
    operationId=queued.id;
    expect(await terminal.promise).toBe(queued.id);
    const result=z.object({data:OperationSchema}).parse(await(await operator.get(`/api/operations/${queued.id}`)).json()).data;
    // Then: the checked nonzero exit is retained and no environment is published.
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("ENVIRONMENT_BUILD_FAILED");
    expect(z.object({lastProcessExitCode:z.number().int()}).parse(result.result).lastProcessExitCode).not.toBe(0);
    const row=await fixture.runtime.db.get<{environment_id:string|null}>("SELECT environment_id FROM environment_builds WHERE operation_id=?",[queued.id]);
    expect(row?.environment_id).toBeNull();
    await writeFile(join(import.meta.dir,"../../../docs/evidence/p2o-environments/failed-package-build.json"),JSON.stringify(result,null,2));
  } finally {
    await stopEnvironmentBuilds(fixture.runtime);
    if(operationId) {
      const cleanup=await runCommand(["docker","image","rm",`quire-environment-build:${operationId}`],{seconds:30});
      expect(cleanup.code===0 || cleanup.stderr.includes("No such image")).toBe(true);
    }
  }
},300000);
