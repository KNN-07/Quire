import { FileEntrySchema, ProjectPathSchema } from "@quire/contracts";
import type { Id, Scope } from "@quire/contracts";
import type { CoreProjects, SourceInput } from "../base";
import { checkFiles, decodeText } from "../base/limits";
import { fail, newId } from "../base/store";
import { run, raw } from "./process";

/** Prepare the full desired browser tree, preserving file identities across branches. */
export async function treeInputs(service: CoreProjects, input: {
  readonly scope: Scope; readonly path: string; readonly commit: string;
}): Promise<readonly SourceInput[]> {
  const project = service.getProject(input.scope.projectId);
  const branch = service.context.db.query("SELECT 1 FROM branch_workspaces WHERE project_id=? AND branch=?")
    .get(input.scope.projectId, input.scope.branch);
  const previous = service.listFiles(branch ? input.scope : { ...input.scope, branch: project.defaultBranch });
  const paths = new Map(previous.map(file => [file.path, file]));
  const listing = await run({ path: input.path, args: ["ls-tree", "-rz", "--full-tree", raw(input.commit)] });
  const entries: SourceInput[] = [];
  for (const row of new TextDecoder().decode(listing.bytes).split("\0").filter(Boolean)) {
    const match = /^(\d+) blob ([0-9a-f]{40})\t([\s\S]+)$/.exec(row);
    if (!match || match[1] !== "100644") fail("UNSAFE_GIT_TREE", 422, "Git submodules and symlinks are unsupported; use ordinary files");
    const path = ProjectPathSchema.parse(match[3]);
    if (path.split("/").some(part => part.toLowerCase() === ".git")) fail("UNSAFE_GIT_TREE", 422, ".git paths are forbidden");
    const object = match[2];
    if (!object) fail("UNSAFE_GIT_TREE", 422, "Missing Git object");
    const bytes = (await run({ path: input.path, args: ["cat-file", "blob", object] })).bytes;
    const text = decodeText(bytes);
    if (text?.startsWith("version https://git-lfs.github.com/spec/v1\n")
      || (path.endsWith(".gitattributes") && text && /\bfilter=lfs\b/.test(text))) {
      fail("GIT_LFS_UNSUPPORTED", 422, "Materialize Git LFS objects as ordinary files before pushing");
    }
    const old = paths.get(path);
    const blob = await service.context.blobs.put(bytes);
    const file = FileEntrySchema.parse({ id: old?.id ?? newId(), path, kind: "file",
      mime: decodeText(bytes) === null ? "application/octet-stream" : "text/plain", blob,
      bytes: bytes.length, editable: decodeText(bytes) !== null, link: null,
      version: { revision: old?.version.revision ?? 0, epoch: (old?.version.epoch ?? 0) + 1 } });
    entries.push(branch && old?.blob === blob ? { file: old } : { file, bytes });
  }
  checkFiles(entries.map(entry => entry.file));
  const main = entries.find(entry => entry.file.id === project.settings.mainFileId);
  if (!main?.file.editable) fail("INVALID_MAIN", 422, "Git tree must retain the configured editable main file");
  const bytes = main.bytes ?? (main.file.blob ? await service.context.blobs.get(main.file.blob) : new Uint8Array());
  if (project.settings.engine !== "plain" && !decodeText(bytes)?.includes("\\documentclass")) {
    fail("INVALID_MAIN", 422, "Git main file requires documentclass");
  }
  return entries;
}
export function ensureWorkspace(service: CoreProjects, scope: Scope): void {
  const now = service.context.clock.now();
  service.context.db.query(`INSERT INTO branch_workspaces(id,project_id,branch,created_at,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(project_id,branch) DO NOTHING`).run(newId(), scope.projectId, scope.branch, now, now);
}
export async function hydrate(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly inputs: readonly SourceInput[];
}) {
  ensureWorkspace(service, input.scope);
  return service.commitSource({ ...input, expectedRevision: service.getBranch(input.scope).revision, reason: "commit" });
}
