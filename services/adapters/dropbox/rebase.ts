import { FileEntrySchema, IdSchema } from "@quire/contracts";
import type { BranchLease, Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects } from "../../core/base";
import type { SourceInput } from "../../core/base";
import type { ActionContext } from "../shared";
import type { DropboxStore, SyncJournal } from "./journal";
import type { Conflict } from "./model";

/** A stale prepared import becomes explicit source copies, never a source overwrite. */
export async function rebasePrepared(input: {
  readonly store: DropboxStore; readonly context: ActionContext; readonly projectId: Id;
  readonly lease: BranchLease; readonly journal: SyncJournal;
}): Promise<SyncJournal> {
  const { services } = input.store, { journal } = input;
  const source = journal.source, state = journal.state;
  if (!source || !state) return journal;
  const projects = new CoreProjects(services.context);
  const branch = await projects.getBranch(source.snapshot.scope);
  const project = await projects.getProject(input.projectId);
  if (branch.revision === source.previousRevision && project.version === source.projectVersion) return journal;
  const existing = await services.context.db.get("SELECT 1 FROM repository_intents WHERE id=?", [source.snapshot.id]);
  if (branch.revision === source.previousRevision) {
    await projects.prepareSource({ actorId: input.context.actorId, scope: source.snapshot.scope,
      lease: input.lease, expectedRevision: branch.revision, inputs: await Promise.all(source.files.map(async file => ({
        file, ...(file.kind === "file" && file.blob ? { bytes: await services.context.blobs.get(file.blob) } : {}),
      }))), reason: "import" });
    const refreshed = { ...journal, source: { ...source, projectVersion: project.version } };
    await input.store.save({ context: input.context, projectId: input.projectId, journal: refreshed });
    return refreshed;
  }
  if (existing) {
    throw new ServiceError("DROPBOX_RECOVERY_CONFLICT", 409, "Published checkpoint has a stale branch; preserve the journal for explicit repository reconciliation");
  }
  const files = await projects.listFiles(source.snapshot.scope);
  const inputs: SourceInput[] = files.map(file => ({ file }));
  const conflicts: Conflict[] = [...state.conflicts];
  for (const intended of source.files) {
    if (intended.kind !== "file" || !intended.blob) continue;
    const current = files.find(file => file.id === intended.id);
    if (current?.blob === intended.blob && current.path === intended.path) continue;
    const copyPath = `${intended.path}.dropbox-recovery-${source.snapshot.id}`;
    const file = FileEntrySchema.parse({ ...intended, id: IdSchema.parse(crypto.randomUUID()),
      path: copyPath, version: { revision: 0, epoch: 0 }, link: null });
    inputs.push({ file, bytes: await services.context.blobs.get(intended.blob) });
    conflicts.push({ kind: "recovery", path: intended.path, remotePath: intended.path, copyPath });
  }
  const replacement = await projects.prepareSource({ actorId: input.context.actorId, scope: source.snapshot.scope,
    lease: input.lease, expectedRevision: branch.revision, inputs, reason: "import" });
  const rebased: SyncJournal = { ...journal, source: replacement,
    state: { ...state, conflicts, files: state.files.map(base => ({
      ...base, local: files.find(file => file.id === base.fileId)?.blob ?? null,
    })) } };
  await input.store.save({ context: input.context, projectId: input.projectId, journal: rebased });
  return rebased;
}
