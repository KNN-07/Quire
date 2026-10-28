import { z } from "zod";
import { zipSync } from "fflate";
import { IdSchema, ProjectPathSchema, assertNever } from "@quire/contracts";
import type { Id, Snapshot } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { CoreProjects, NativeFile, ProjectExportRequest } from "../../core/base";
import { recordOperation } from "../../core/base/operations";
import { conversionLosses } from "./converter";
import type { PandocConverter } from "./converter";

export class InterchangeExports {
  constructor(private readonly projects: CoreProjects, private readonly converter: PandocConverter) {}
  async snapshot(input: ProjectExportRequest): Promise<Snapshot> {
    const project = await this.projects.getProject(input.projectId);
    const scope = { projectId: project.id, branch: project.defaultBranch };
    await this.projects.authorize(input.actorId, scope, "download");
    await this.projects.policy(input.actorId, input.projectId);
    const revision = (await this.projects.getBranch(scope)).revision;
    const snapshot = input.snapshotId ? await this.projects.getSnapshot(input.snapshotId)
      : await this.projects.getSnapshot((await this.projects.one(
        "SELECT id FROM snapshots WHERE project_id=? AND branch=? AND revision=? ORDER BY created_at DESC,id DESC LIMIT 1",
        [project.id, scope.branch, revision], z.object({ id: IdSchema }))).id);
    if (snapshot.scope.projectId !== project.id) throw new ServiceError("SCOPE_MISMATCH", 400, "Snapshot belongs to another project");
    return snapshot;
  }
  async export(input: ProjectExportRequest) {
    const snapshot = await this.snapshot(input);
    const files = (await this.projects.readSnapshot(snapshot.id)).files;
    const entries: NativeFile[] = await Promise.all(files.map(async file => ({
      path: file.path, bytes: file.blob ? await this.projects.context.blobs.get(file.blob) : new Uint8Array(),
      folder: file.kind === "folder",
    })));
    const manifest: {
      snapshotId: Id; kind: string; source: string[]; generated: string[]; losses: readonly string[];
    } = { snapshotId: snapshot.id, kind: input.kind, source: entries.map(file => file.path), generated: [], losses: conversionLosses };
    const packaged: Record<string, Uint8Array> = Object.create(null);
    switch (input.kind) {
    case "submission": {
      for (const entry of entries) packaged[`source/${entry.path}${entry.folder ? "/" : ""}`] = entry.bytes;
      const jobRow = await this.projects.context.db.get<{ id: string }>(
        "SELECT id FROM compile_jobs WHERE snapshot_id=? AND status='succeeded' ORDER BY finished_at DESC,id DESC LIMIT 1", [snapshot.id]);
      if (!jobRow) throw new ServiceError("SUBMISSION_COMPILE_REQUIRED", 503,
        "Compile this exact snapshot successfully in an installed isolated compiler environment before submission export");
      const job = await this.projects.context.services.get("compiler").get(input.actorId, IdSchema.parse(jobRow.id));
      if (job.snapshot.id !== snapshot.id || job.status !== "succeeded") throw new ServiceError("SUBMISSION_COMPILE_REQUIRED", 409, "Compile artifact snapshot changed");
      const artifacts = job.artifacts.filter(artifact => artifact.kind === "pdf" || artifact.name.endsWith(".bbl"));
      if (!artifacts.some(artifact => artifact.kind === "pdf")) throw new ServiceError("SUBMISSION_PDF_REQUIRED", 422, "Successful compiler job has no actual PDF artifact");
      const bibliography = entries.some(file => file.path.endsWith(".bib"));
      if (bibliography && !artifacts.some(artifact => artifact.name.endsWith(".bbl"))) throw new ServiceError("SUBMISSION_BBL_REQUIRED", 422,
        "Bibliography source requires an actual generated .bbl artifact; compile with BibTeX/Biber and retain the output");
      for (const artifact of artifacts) {
        const path = ProjectPathSchema.parse(artifact.name);
        const bytes = await this.projects.context.blobs.get(artifact.sha256);
        if (artifact.kind === "pdf" && new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
          throw new ServiceError("SUBMISSION_INVALID_PDF", 422, "Compiler PDF artifact is invalid");
        }
        packaged[`generated/${path}`] = bytes;
        manifest.generated.push(path);
      }
      break;
    }
    case "docx":
    case "markdown":
    case "html": {
      const project = await this.projects.getProject(input.projectId);
      const main = files.find(file => file.id === project.settings.mainFileId);
      if (!main || main.kind !== "file") throw new ServiceError("INVALID_MAIN", 422, "Snapshot does not contain the selected project main");
      const converted = await this.converter.convert({ entries, main: main.path, from: "latex", to: input.kind });
      for (const file of converted) {
        packaged[`converted/${file.path}${file.folder ? "/" : ""}`] = file.bytes;
        manifest.generated.push(file.path);
      }
      break;
    }
    default: return assertNever(input.kind);
    }
    packaged["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    return recordOperation(this.projects, {
      actorId: input.actorId, key: input.key, kind: `${input.kind}-export`, projectIds: [input.projectId],
      bytes: zipSync(packaged),
      preflight: async bound => {
        const project = await bound.getProject(input.projectId);
        await bound.authorize(input.actorId, { projectId: input.projectId, branch: project.defaultBranch }, "download");
        await bound.policy(input.actorId, input.projectId);
      },
    });
  }
}
