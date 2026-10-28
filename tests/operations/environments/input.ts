import { FileEntrySchema } from "@quire/contracts";
import type { Environment } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { fixtureIds } from "../../fixtures/foundation";

export async function profileInput(context: ModuleContext, environment: Environment, sources: Readonly<Record<string,string|Uint8Array>>) {
  const files = [];
  for (const [path,value] of Object.entries(sources)) {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
    const blob = await context.blobs.put(bytes);
    files.push(FileEntrySchema.parse({id:path==="main.tex" ? fixtureIds.mainFile : crypto.randomUUID(),path,kind:"file",
      mime:path.endsWith(".tex") ? "text/x-tex" : "application/octet-stream",blob,bytes:bytes.length,editable:path.endsWith(".tex"),
      version:{revision:0,epoch:0},link:null}));
  }
  return {environment,files,blobs:context.blobs,settings:{engine:"pdflatex" as const,mainFileId:fixtureIds.mainFile,
    environmentId:environment.id,draft:false,stopOnFirstError:true}};
}
