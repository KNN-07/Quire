import { createHash } from "node:crypto";
import { FileEntrySchema, IdSchema } from "@quire/contracts";
import type { BlobStore, FileEntry, Id } from "@quire/contracts";
import type { SourceInput } from "../../core/base";
import { contentHash, generatedPath } from "./model";
import type { Conflict, RemoteFile, SyncState } from "./model";

export type SyncTransport = {
  readonly download: (file: RemoteFile) => Promise<Uint8Array>;
  readonly upload: (input: { readonly path: string; readonly bytes: Uint8Array; readonly previous: RemoteFile | null }) => Promise<RemoteFile>;
  readonly delete: (file: RemoteFile) => Promise<void>;
};
type MergeWorkspace = {
  readonly projectId: Id; readonly mainId: Id; readonly files: readonly FileEntry[];
  readonly archived: boolean; readonly root?: string;
};
export async function mergeSources(input: {
  readonly workspace: MergeWorkspace;
  readonly state: SyncState; readonly remote: readonly RemoteFile[];
}, services: { readonly blobs: BlobStore; readonly transport: SyncTransport }) {
  const { workspace } = input;
  const root = `${workspace.root ?? `/${workspace.projectId}`}/`;
  const remote = new Map(input.remote.filter(file => file.path_lower.startsWith(root.toLowerCase())).map(file => [file.path_lower, file]));
  const inputs = new Map<Id, SourceInput>(workspace.files.map(file => [file.id, { file }]));
  const baselines: SyncState["files"] = [];
  const conflicts: Conflict[] = [...input.state.conflicts];
  const consumed = new Set<string>();
  let changed = false;
  async function receive(file: RemoteFile, previous?: FileEntry, copy = false) {
    const path = file.path_display.slice(root.length);
    const suffix = createHash("sha256").update(`${file.id}:${file.rev}`).digest("hex").slice(0, 12);
    const target = copy ? `${path}.dropbox-conflict-${suffix}` : path;
    const collision = [...inputs.values()].find(item => item.file.path.toLowerCase() === target.toLowerCase());
    if (collision && collision.file.id !== previous?.id) {
      if (!copy) return receive(file, undefined, true);
      return target;
    }
    const bytes = await services.transport.download(file);
    const blob = await services.blobs.put(bytes);
    const next = FileEntrySchema.parse(previous ? { ...previous, path: target, blob } : {
      id: IdSchema.parse(crypto.randomUUID()), path: target, kind: "file", mime: "application/octet-stream",
      blob, bytes: bytes.length, editable: false, link: null, version: { revision: 0, epoch: 0 },
    });
    inputs.set(next.id, { file: next, bytes }); changed = true;
    return target;
  }
  async function preserve(kind: Conflict["kind"], path: string, file: RemoteFile | null) {
    const copyPath = file && !workspace.archived ? await receive(file, undefined, true) : null;
    const entry = { kind, path, remotePath: file?.path_display.slice(root.length) ?? null, copyPath };
    if (!conflicts.some(value => JSON.stringify(value) === JSON.stringify(entry))) conflicts.push(entry);
  }
  const candidates = [
    ...input.state.files.map(base => ({ base, local: workspace.files.find(file => file.id === base.fileId) })),
    ...workspace.files.filter(file => file.kind === "file" && !input.state.files.some(base => base.fileId === file.id))
      .map(local => ({ base: undefined, local })),
  ];
  for (const { base, local } of candidates) {
    const path = local?.path ?? base?.path;
    if (path === undefined || generatedPath(path)) continue;
    const atPath = remote.get(`${root}${path}`.toLowerCase()) ?? null;
    const renamed = base?.remote ? [...remote.values()].find(file => file.id === base.remote?.id) : undefined;
    const theirs = renamed ?? atPath;
    if (theirs) consumed.add(theirs.path_lower);
    const localChanged = !base || (local?.blob ?? null) !== base.local || local?.path !== base.path;
    const remoteChanged = !base || (theirs?.rev ?? null) !== (base.remote?.rev ?? null)
      || theirs?.path_lower !== base.remote?.path_lower;
    const rename = Boolean(base && ((local && local.path !== base.path)
      || (base.remote && theirs && theirs.path_lower !== base.remote.path_lower)));
    let outcome = theirs;
    if (rename) {
      await preserve("rename", path, theirs);
    } else if (local && theirs && local.blob
      && contentHash(await services.blobs.get(local.blob)) === theirs.content_hash) {
      // An acknowledged or uncertain prior upload is already converged.
    } else if (localChanged && remoteChanged) {
      if (local && !theirs && !base) {
        outcome = await services.transport.upload({ path: `${root}${path}`, bytes: local.blob ? await services.blobs.get(local.blob) : new Uint8Array(), previous: null });
        remote.set(outcome.path_lower, outcome); consumed.add(outcome.path_lower);
      } else await preserve(!local || !theirs ? "delete" : "content", path, theirs);
    } else if (localChanged) {
      if (local && local.blob) {
        outcome = await services.transport.upload({ path: `${root}${path}`, bytes: await services.blobs.get(local.blob), previous: theirs });
        remote.set(outcome.path_lower, outcome); consumed.add(outcome.path_lower);
      } else if (theirs) {
        await services.transport.delete(theirs); remote.delete(theirs.path_lower); outcome = null;
      }
    } else if (remoteChanged && !workspace.archived) {
      if (theirs && local) await receive(theirs, local);
      else if (local && local.id !== workspace.mainId) { inputs.delete(local.id); changed = true; }
      else if (local) await preserve("main-delete", path, null);
    }
    const applied = local ? inputs.get(local.id)?.file : undefined;
    if (applied) baselines.push({ fileId: applied.id, path: applied.path, local: applied.blob,
      remote: workspace.archived && remoteChanged && !localChanged && base ? base.remote : outcome });
    else if (base && outcome) baselines.push({ ...base, local: null, remote: outcome });
  }
  for (const file of remote.values()) {
    const path = file.path_display.slice(root.length);
    if (consumed.has(file.path_lower) || generatedPath(path) || workspace.archived) continue;
    const target = await receive(file);
    const imported = [...inputs.values()].find(item => item.file.path === target);
    if (imported) baselines.push({ fileId: imported.file.id, path: target, local: imported.file.blob, remote: file });
  }
  return { inputs: [...inputs.values()], changed, files: baselines, remote: [...remote.values()], conflicts };
}
