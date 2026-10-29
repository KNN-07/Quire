import { z } from "zod";
import { DigestSchema, IdSchema, ProjectPathSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import type { SyncTransport } from "./merge";
import type { RemoteFile } from "./model";
import { contentHash } from "./model";

export async function exportGenerated(input: {
  readonly context: ModuleContext; readonly projectId: Id; readonly branch: string;
  readonly remote: readonly RemoteFile[]; readonly transport: SyncTransport; readonly root?: string;
}): Promise<readonly RemoteFile[]> {
  const job = await input.context.db.get<{ id: string }>(`SELECT j.id FROM compile_jobs j
    JOIN snapshots s ON s.id=j.snapshot_id WHERE s.project_id=? AND s.branch=? AND j.status='succeeded'
    ORDER BY j.finished_at DESC,j.id DESC LIMIT 1`, [input.projectId, input.branch]);
  if (!job) return input.remote;
  const rows = await input.context.db.query(
    "SELECT name,sha256 FROM artifacts WHERE job_id=? AND kind IN ('pdf','dvi','generated') ORDER BY name",
    [job.id], z.object({ name: ProjectPathSchema, sha256: DigestSchema }));
  const files = new Map(input.remote.map(file => [file.path_lower, file]));
  for (const artifact of rows) {
    const path = `${input.root ?? `/${input.projectId}`}/.quire-generated/${IdSchema.parse(job.id)}/${artifact.name}`;
    const bytes = await input.context.blobs.get(artifact.sha256);
    const existing = files.get(path.toLowerCase());
    if (existing) {
      if (existing.content_hash !== contentHash(bytes)) {
        throw new ServiceError("DROPBOX_GENERATED_CONFLICT", 409, "Generated output was independently modified; preserved without overwrite");
      }
    } else {
      const uploaded = await input.transport.upload({ path, bytes, previous: null });
      files.set(uploaded.path_lower, uploaded);
    }
  }
  return [...files.values()];
}
