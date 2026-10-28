import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CompileJobSchema } from "@quire/contracts";
import { CoreProjects } from "../../../services/core/base";
import { startWorker } from "../../../services/compiler";
import { saveEnvironment } from "../../../services/operations/environments/registry";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { runCommand } from "../../../services/operations/environments/process";
import { environmentFixture } from "./harness";
import { verifiedReport } from "./image";

test("publishes and compiles a standalone main.Rnw project through the actual application",async()=>{
  // Given: an executed knitr manifest and an application project with no dummy TeX main.
  await using fixture=await environmentFixture();
  const operator=await fixture.login();
  const user=await fixture.login("kien@quire.local");
  const report=await verifiedReport("knitr");
  const manifest=manifestFromProbe({id:crypto.randomUUID(),label:"Standalone application knitr",report});
  await saveEnvironment(fixture.context,{manifest,report,actor:operator.actor});
  const completed=new Set<string>();
  const terminal=Promise.withResolvers<void>();
  let expectedJob:string|null=null;
  const timeout=setTimeout(()=>terminal.reject(new TypeError("Standalone knitr terminal event timed out")),180000);
  const unsubscribe=fixture.runtime.events.subscribe(event=>{
    if(event.topic==="job.changed" && !["queued","running"].includes(event.payload.status)) {
      completed.add(event.payload.resourceId);
      if(event.payload.resourceId===expectedJob) terminal.resolve();
    }
  });
  try {
    const project=await new CoreProjects(fixture.context).createFromFiles(user.actor.id,{
      name:"Standalone real knitr",mainPath:"main.Rnw",engine:"pdflatex",environmentId:manifest.id,
      entries:[{path:"main.Rnw",bytes:new TextEncoder().encode(String.raw`\documentclass{article}
\begin{document}
<<calculation,echo=FALSE,results='asis'>>=
cat("QUIRERNWRESULT",sum(1:10),sep="")
@
\end{document}`)}],
    });
    const branch=await fixture.runtime.db.get<{revision:number}>(
      "SELECT revision FROM branch_workspaces WHERE project_id=? AND branch='main'",[project.id]);
    if(!branch) throw new TypeError("Missing published standalone knitr branch");
    const paths=await fixture.runtime.db.all<{path:string}>(`SELECT f.path FROM files f
      JOIN branch_workspaces b ON b.id=f.branch_id
      WHERE b.project_id=? AND b.branch='main' AND f.deleted_at IS NULL ORDER BY f.path`,[project.id]);
    expect(paths.map(file=>file.path)).toEqual(["main.Rnw"]);
    await startWorker(fixture.runtime);
    // When: the real compile HTTP surface receives the published Rnw-only project.
    const response=await user.write(`/api/projects/${project.id}/compiles`,{
      scope:{projectId:project.id,branch:"main"},expectedRevision:branch.revision,clean:false,settings:project.settings,
    });
    expect(response.status).toBe(202);
    const queued=z.object({data:CompileJobSchema}).parse(await response.json()).data;
    expectedJob=queued.id;
    if(completed.has(queued.id)) terminal.resolve();
    await terminal.promise;
    const result=z.object({data:CompileJobSchema}).parse(await(await user.get(`/api/compiles/${queued.id}`)).json()).data;
    // Then: actual R output survives authorized PDF delivery from the selected Docker profile.
    expect(result.status).toBe("succeeded");
    expect(result.environmentId).toBe(manifest.id);
    const artifact=result.artifacts.find(item=>item.kind==="pdf");
    if(!artifact) throw new TypeError("Standalone knitr produced no PDF artifact");
    const download=await user.get(`/api/artifacts/${artifact.id}/content`);
    expect(download.status).toBe(200);
    const evidence=join(import.meta.dir,"../../../docs/evidence/p2o-environments");
    const pdfPath=join(evidence,"standalone-knitr.pdf");
    await writeFile(pdfPath,new Uint8Array(await download.arrayBuffer()));
    const text=await runCommand(["pdftotext",pdfPath,"-"],{seconds:15});
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("QUIRERNWRESULT55");
    await writeFile(join(evidence,"standalone-knitr.json"),JSON.stringify({projectId:project.id,paths,job:result,pdfText:text.stdout},null,2));
  } finally {clearTimeout(timeout);unsubscribe();}
},300000);
