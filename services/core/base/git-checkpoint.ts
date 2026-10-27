import { join } from "node:path";
import { GitOidSchema } from "@quire/contracts";
import type { FileEntry, Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { fail } from "./store";

export function repositoryPath(context: ModuleContext, projectId: Id): string {
  return join(context.config.dataDir, "git", `${projectId}.git`);
}
export async function git(path: string, args: readonly string[], input?: Uint8Array): Promise<string> {
  const child = Bun.spawn(["git", "--git-dir", path, ...args], {
    stdin: input ? new Blob([new Uint8Array(input)]) : "ignore", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  });
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) fail("GIT_CHECKPOINT_FAILED", 500, error.trim());
  return output.trim();
}
export async function initializeRepository(context: ModuleContext, projectId: Id): Promise<void> {
  const path = repositoryPath(context, projectId);
  await git(path, ["init", "--bare", "--initial-branch=main", path]);
  await git(path, ["config", "transfer.hideRefs", "refs/quire/"]);
  await git(path, ["config", "receive.hideRefs", "refs/quire/"]);
  await git(path, ["config", "core.fsync", "committed"]);
}
type TreeNode = { readonly files: Map<string, string>; readonly folders: Map<string, TreeNode> };
export async function writeCheckpoint(context: ModuleContext, projectId: Id, files: readonly FileEntry[]) {
  const path = repositoryPath(context, projectId);
  const root: TreeNode = { files: new Map(), folders: new Map() };
  for (const file of files) {
    if (file.kind === "folder" || file.blob === null) continue;
    const parts = file.path.split("/");
    const name = parts.pop();
    if (name === undefined) fail("INVALID_PATH", 400, "Empty file name");
    let node = root;
    for (const part of parts) {
      let child = node.folders.get(part);
      if (!child) { child = { files: new Map(), folders: new Map() }; node.folders.set(part, child); }
      node = child;
    }
    const oid = await git(path, ["hash-object", "-w", "--stdin"], await context.blobs.get(file.blob));
    node.files.set(name, oid);
  }
  async function tree(node: TreeNode): Promise<string> {
    const entries: string[] = [];
    for (const [name, oid] of node.files) entries.push(`100644 blob ${oid}\t${name}\0`);
    for (const [name, child] of node.folders) entries.push(`040000 tree ${await tree(child)}\t${name}\0`);
    return git(path, ["mktree", "-z"], new TextEncoder().encode(entries.join("")));
  }
  const oid = await tree(root);
  const commit = await git(path, ["-c", "user.name=Quire", "-c", "user.email=quire@localhost",
    "commit-tree", oid, "-m", "Quire source checkpoint"]);
  return { tree: GitOidSchema.parse(`sha1:${oid}`), commit };
}
