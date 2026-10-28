import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CompileJobSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { environmentFixture } from "./harness";
import { verifiedReport } from "./image";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { saveEnvironment } from "../../../services/operations/environments/registry";
import { startWorker } from "../../../services/compiler";

test("dispatches a selected immutable Docker environment through the real compiler HTTP workflow",async()=>{
  // Given: a private real runtime with the O provider wired after C registration.
  await using fixture = await environmentFixture();
  const report = await verifiedReport();
  const manifest = manifestFromProbe({id:crypto.randomUUID(),label:"HTTP Docker compiler",report});
  const operator=await fixture.login();
  await saveEnvironment(fixture.context,{manifest,report,actor:operator.actor});
  const user = await fixture.login("kien@quire.local");
  const branch = await fixture.runtime.db.get<{revision:number}>("SELECT revision FROM branch_workspaces WHERE id=?",[fixtureIds.branch]);
  if (!branch) throw new TypeError("Missing owned project branch");
  const terminal = Promise.withResolvers<string>();
  const timeout = setTimeout(()=>terminal.reject(new TypeError("Docker job terminal event timed out")),180000);
  const unsubscribe = fixture.runtime.events.subscribe(event=>{
    if (event.topic==="job.changed" && !["queued","running"].includes(event.payload.status)) {
      terminal.resolve(event.payload.resourceId);
    }
  });
  try {
    await startWorker(fixture.runtime);
    // When: the real Editor HTTP surface requests this immutable environment.
    const response = await user.write(`/api/projects/${fixtureIds.project}/compiles`,{
      scope:{projectId:fixtureIds.project,branch:"main"},expectedRevision:branch.revision,clean:false,
      settings:{engine:"pdflatex",mainFileId:fixtureIds.mainFile,environmentId:manifest.id,draft:false,stopOnFirstError:true},
    });
    expect(response.status).toBe(202);
    const job = z.object({data:CompileJobSchema}).parse(await response.json()).data;
    expect(await terminal.promise).toBe(job.id);
    // Then: the persisted job and actual authorized PDF are from the selected Docker profile.
    const completed = await user.get(`/api/compiles/${job.id}`);
    const result = z.object({data:CompileJobSchema}).parse(await completed.json()).data;
    expect(result.status).toBe("succeeded");
    expect(result.environmentId).toBe(manifest.id);
    const artifact = result.artifacts.find(item=>item.kind==="pdf");
    if (!artifact) throw new TypeError("Actual Docker compile returned no PDF artifact");
    const download = await user.get(`/api/artifacts/${artifact.id}/content`);
    expect(download.status).toBe(200);
    const pdf = new Uint8Array(await download.arrayBuffer());
    expect(new TextDecoder().decode(pdf.subarray(0,5))).toBe("%PDF-");
    await writeFile(join(import.meta.dir,"../../../docs/evidence/p2o-environments/docker-dispatch.pdf"),pdf);
    await writeFile(join(import.meta.dir,"../../../docs/evidence/p2o-environments/docker-dispatch.json"),JSON.stringify(result,null,2));
  } finally {clearTimeout(timeout);unsubscribe();}
},300000);
