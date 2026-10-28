import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { GitHunkSchema } from "@quire/contracts";
import type { Id, Scope, GitHunk } from "@quire/contracts";
import type { CoreProjects } from "../base";
import { fail } from "../base/store";
import { run, encode, oid, stableId, objects, copyTree } from "./process";

export type PatchHunk = { readonly hunk: GitHunk; readonly header: string; readonly patch: string };
const savedPatch = z.object({ hunk: GitHunkSchema, header: z.string(), patch: z.string() });
export async function diffHunks(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly head: string; readonly tree: string;
}): Promise<readonly PatchHunk[]> {
  const revision = (await service.getBranch(input.scope)).revision;
  const files = await service.listFiles(input.scope);
  const base = (await objects(service, input.scope, ["ls-tree", "-rz", input.head])).text;
  const oldPaths = base.split("\0").map(row => row.split("\t")[1]).filter((p): p is string => p !== undefined);
  const staged = await stagedHunks(service, input);
  const result: PatchHunk[] = [];
  for (const filePath of new Set([...files.filter(file => file.kind !== "folder").map(file => file.path), ...oldPaths])) {
    const file = files.find(item => item.path === filePath);
    const fileId = file?.id ?? stableId(`${input.scope.projectId}:${input.scope.branch}:${filePath}`);
    const diff = (await objects(service, input.scope, ["diff", "--binary", "--no-ext-diff", "--no-textconv",
      "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", input.head, input.tree, "--", filePath])).text;
    if (!diff) continue;
    const start = diff.indexOf("\n@@ ");
    const header = start >= 0 ? diff.slice(0, start + 1) : "";
    const chunks = start >= 0 ? diff.slice(start + 1).split(/(?=^@@ )/m).filter(Boolean) : [diff];
    for (const chunk of chunks) {
      const range = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(chunk);
      const before: string[] = [];
      const after: string[] = [];
      for (const line of chunk.split("\n").slice(1)) {
        if (line.startsWith("-") || line.startsWith(" ")) before.push(line.slice(1));
        if (line.startsWith("+") || line.startsWith(" ")) after.push(line.slice(1));
      }
      const id = stableId(`${input.head}:${filePath}:${chunk}`);
      result.push({ header, patch: `${chunk}${range ? "\n" : "\n\n"}`, hunk: GitHunkSchema.parse({
        id, fileId, path: filePath, baseHead: oid(input.head), baseRevision: revision,
        oldStart: Number(range?.[1] ?? 0), oldLines: Number(range?.[2] ?? (range ? 1 : 0)),
        newStart: Number(range?.[3] ?? 0), newLines: Number(range?.[4] ?? (range ? 1 : 0)),
        before: before.join("\n"), after: after.join("\n"), staged: staged.some(item => item.hunk.id === id),
      }) });
    }
  }
  for (const saved of staged) {
    if (!result.some(item => item.hunk.id === saved.hunk.id)) result.push({
      ...saved, hunk: { ...saved.hunk, baseRevision: revision, staged: true },
    });
  }
  return result;
}
export async function stagedHunks(service: CoreProjects, input: { readonly actorId: Id; readonly scope: Scope; readonly head: string }): Promise<readonly PatchHunk[]> {
  const row = await service.context.db.get<{ head: string; revision: number; hunks_json: string }>(
    "SELECT head,revision,hunks_json FROM core_git_staging WHERE project_id=? AND branch=? AND user_id=?",
    [input.scope.projectId, input.scope.branch, input.actorId]);
  return row?.head === input.head ? z.array(savedPatch).parse(JSON.parse(row.hunks_json)) : [];
}
export async function patchedTree(service: CoreProjects, scope: Scope, input: {
  readonly base: string; readonly hunks: readonly PatchHunk[]; readonly reverse?: boolean;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "quire-git-index-"));
  try {
    const path = join(root, "objects.git");
    await run({ path, args: ["init", "--bare", path] });
    const remote = (args: readonly string[], bytes?: Uint8Array) => objects(service, scope, args, bytes);
    const local = (args: readonly string[], bytes?: Uint8Array) => run({ path, args, ...(bytes ? { input: bytes } : {}) });
    const base = (await remote(["rev-parse", `${input.base}^{tree}`])).text;
    await copyTree(remote, local, base);
    const env = { GIT_INDEX_FILE: join(root, "index") };
    await run({ path, args: ["read-tree", base], env });
    const groups = new Map<string, { readonly header: string; readonly chunks: string[] }>();
    for (const hunk of input.hunks) {
      let group = groups.get(hunk.hunk.path);
      if (!group) { group = { header: hunk.header, chunks: [] }; groups.set(hunk.hunk.path, group); }
      group.chunks.push(hunk.patch);
    }
    const patch = [...groups.values()].map(group => group.header + group.chunks.join("")).join("");
    if (!patch) fail("EMPTY_STAGE", 422, "Select at least one current hunk");
    await run({ path, args: ["apply", "--cached", "--binary", ...(input.reverse ? ["--reverse"] : []), "-"],
      env, input: encode(patch) });
    return await copyTree(local, remote, (await run({ path, args: ["write-tree"], env })).text);
  } finally { await rm(root, { recursive: true, force: true }); }
}
