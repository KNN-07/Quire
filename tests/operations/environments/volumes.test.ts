import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownedImage } from "./image";
import { rejectionCode } from "./error";
import { runCommand } from "../../../services/operations/environments/process";
import { dockerSandbox } from "../../../workers/compiler/docker";
import { defaultLimits } from "../../../workers/compiler/sandbox";

test("rejects image-declared writable volumes before they bypass the workspace quota",async()=>{
  // Given: a real owned image with a Docker VOLUME declaration.
  const root = await mkdtemp(join(tmpdir(),"quire-environment-volume-"));
  const tag = `quire-environment-rejected:${crypto.randomUUID()}`;
  let built=false;
  try {
    const base = await ownedImage();
    await writeFile(join(root,"Dockerfile"),`FROM quire-p2o-environments:st_01a17c2c@${base}\nVOLUME /unbounded\n`);
    const result = await runCommand(["docker","build","--iidfile",join(root,"image.id"),"-t",tag,root],{seconds:60});
    expect(result.code).toBe(0);
    built=true;
    const image = (await readFile(join(root,"image.id"),"utf8")).trim();
    // When: the sandbox is asked to execute that actual immutable image.
    const action = dockerSandbox({image,source:root,limits:defaultLimits,command:["/bin/true"]});
    // Then: no unconstrained anonymous writable mount is admitted.
    expect(await rejectionCode(action)).toBe("INVALID_IMAGE_VOLUMES");
  } finally {
    if (built) {
      const cleanup = await runCommand(["docker","image","rm",tag],{seconds:30});
      expect(cleanup.code).toBe(0);
    }
    await rm(root,{recursive:true,force:true});
  }
},90000);
