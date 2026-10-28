import type { ModuleContext } from "@quire/runtime";
import { CoreProjects } from "./projects";
import { registerProjectRoutes } from "./project-routes";
import { registerFileRoutes } from "./file-routes";
import { registerTags } from "./tags";
import { registerAccess } from "./access-routes";
import { registerProjectRecovery } from "./admin-recovery";

export { migrations } from "./migrations";
export { CoreProjects } from "./projects";
export type { NativeFile } from "./projects";
export type { SourceInput, SourceDocument, SourceIntent } from "./source-records";
export { sourceIntent } from "./source-records";
export type { SourceCommitInput, SourcePreparation, PreparedSources } from "./source-composition";
export type { SourceReceipt, HttpReceipt, HttpSourceReceipt, TransactionContext } from "./receipts";
export type { SourceFinalization } from "./source-finalization";
export { importZip, readZip, sourceZip } from "./archives";
export { uploadFiles, moveFile, deleteFile, emptyFile, mutateFiles } from "./files";
export { repositoryPath, git } from "./git-checkpoint";
export { exportSource, downloadOperation, operation } from "./operations";
export { provideProjectExporter } from "./export-adapter";
export type { ProjectExporter, ProjectExportRequest } from "./export-adapter";
export { provideExternalLinks } from "./link-adapter";
export type { ExternalLinks } from "./link-adapter";

export async function register(context: ModuleContext): Promise<void> {
  const service = new CoreProjects(context);
  await service.recover();
  context.services.provide("projects", service);
  registerProjectRoutes(context, service);
  registerFileRoutes(context, service);
  registerTags(context, service);
  registerAccess(context, service);
  registerProjectRecovery(context);
}
