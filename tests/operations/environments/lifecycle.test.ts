import { expect, test } from "bun:test";
import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import { environmentFixture } from "./harness";
import { verifiedReport } from "./image";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { saveEnvironment } from "../../../services/operations/environments/registry";
import { stopEnvironmentBuilds } from "../../../services/operations/environments";
import { runCommand } from "../../../services/operations/environments/process";

test("cancels and drains an actual build child when supervisor shutdown follows its started event",async()=>{
  // Given: a real queued build and an event subscription installed before its submission.
  await using fixture=await environmentFixture();
  const operator=await fixture.login();
  const report=await verifiedReport();
  const base=manifestFromProbe({id:crypto.randomUUID(),label:"Supervised build",report});
  await saveEnvironment(fixture.context,{manifest:base,report,actor:operator.actor});
  const ready=Promise.withResolvers<{readonly id:string;readonly stopped:Promise<void>}>();
  const timeout=setTimeout(()=>ready.reject(new TypeError("Build child did not start")),30000);
  let running=0;
  let operationId:string|undefined;
  const unsubscribe=fixture.runtime.events.subscribe(event=>{
    if(event.topic==="operation.changed" && event.payload.status==="running") {
      running++;
      if(running===2) {
        // The second running event is emitted by runCommand after Bun.spawn,
        // before returning control to the build's next phase.
        ready.resolve({id:event.payload.resourceId,stopped:stopEnvironmentBuilds(fixture.runtime)});
      }
    }
  });
  try {
    // When: shutdown is triggered directly by the real child-start event.
    const response=await operator.write("/api/admin/environments/build",{
      baseId:base.id,packageList:[],fontUploads:[],mirror:"https://archive.ubuntu.com/ubuntu/"});
    expect(response.status).toBe(202);
    const queued=z.object({data:OperationSchema}).parse(await response.json()).data;
    operationId=queued.id;
    const started=await ready.promise;
    expect(started.id).toBe(queued.id);
    await started.stopped;
    // Then: a durable canceled result exists and no environment was published.
    const terminal=z.object({data:OperationSchema}).parse(await(await operator.get(`/api/operations/${queued.id}`)).json()).data;
    expect(terminal.status).toBe("canceled");
    expect(terminal.errorCode).toBe("ENVIRONMENT_BUILD_CANCELED");
    const row=await fixture.runtime.db.get<{environment_id:string|null}>("SELECT environment_id FROM environment_builds WHERE operation_id=?",[queued.id]);
    expect(row?.environment_id).toBeNull();
  } finally {
    clearTimeout(timeout);unsubscribe();await stopEnvironmentBuilds(fixture.runtime);
    if(operationId) {
      const cleanup=await runCommand(["docker","image","rm",`quire-environment-build:${operationId}`],{seconds:30});
      expect(cleanup.code===0 || cleanup.stderr.includes("No such image")).toBe(true);
    }
  }
},300000);
