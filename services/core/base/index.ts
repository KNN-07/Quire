import type { ModuleContext } from "@quire/runtime";
import { CoreProjects } from "./projects";
import { registerProjectRoutes } from "./project-routes";
import { registerFileRoutes } from "./file-routes";
import { registerTags } from "./tags";
import { registerAccess } from "./access-routes";

export { migrations } from "./migrations";
export { CoreProjects } from "./projects";
export type { NativeFile } from "./projects";
export type { SourceInput, SourceDocument } from "./source-records";
export { importZip, readZip, sourceZip } from "./archives";
export { uploadFiles, moveFile, deleteFile, emptyFile, mutateFiles } from "./files";
export { repositoryPath, git } from "./git-checkpoint";
export { exportSource, downloadOperation, operation } from "./operations";
export { provideProjectExporter } from "./export-adapter";
export type { ProjectExporter, ProjectExportRequest } from "./export-adapter";

export async function register(context: ModuleContext): Promise<void> {
  const service = new CoreProjects(context);
  await service.recover();
  context.services.provide("projects", service);
  registerProjectRoutes(context, service);
  registerFileRoutes(context, service);
  registerTags(context, service);
  registerAccess(context, service);
}
