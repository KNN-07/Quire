import type { Id, Operation } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { fail } from "./store";

export type ProjectExportRequest = {
  readonly actorId: Id; readonly projectId: Id; readonly snapshotId?: Id;
  readonly kind: "submission" | "docx" | "markdown" | "html"; readonly key: string;
};
export type ProjectExporter = (input: ProjectExportRequest) => Promise<Operation>;
const exporters = new WeakMap<object, ProjectExporter>();
/** X/C register a real converter after base; the base module retains the single HTTP route. */
export function provideProjectExporter(context: ModuleContext, exporter: ProjectExporter): void {
  if (exporters.has(context.db)) fail("DUPLICATE_EXPORTER", 500, "Project exporter already registered");
  exporters.set(context.db, exporter);
}
export function delegatedExport(context: ModuleContext, request: ProjectExportRequest): Promise<Operation> {
  const exporter = exporters.get(context.db);
  if (!exporter) fail("EXPORT_ADAPTER_REQUIRED", 503, "This format requires a configured compiler/conversion exporter");
  return exporter(request);
}
