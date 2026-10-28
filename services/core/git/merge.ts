import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitConflictSchema, ProjectPathSchema } from "@quire/contracts";
import type {
  BranchLease, GitConflict, GitOid, Id, Operation, Scope,
} from "@quire/contracts";
import { decodeText } from "../base/limits";
import { fail } from "../base/store";
import { gitReceipt, previousReceipt } from "./actions";
import { copyTree, encode, objects, oid, run, stableId, branchName } from "./process";
import type { GitRepository } from "./repository";
import { treeInputs } from "./trees";
import { compareHeads } from "./ancestry";

type ConflictStage = {
  readonly path: string;
  readonly objects: ReadonlyMap<number, string>;
};
type MergeAnalysis =
  | { readonly kind: "clean"; readonly tree: string; readonly fromHead: string }
  | {
      readonly kind: "conflict";
      readonly tree: string;
      readonly fromHead: string;
      readonly base: string;
      readonly stages: readonly ConflictStage[];
      readonly conflict: GitConflict;
    };
type ConflictResolution =
  | { readonly path: string; readonly choice: "ours" | "theirs" | "delete" }
  | { readonly path: string; readonly choice: "text"; readonly text: string };
type ResolveBody = {
  readonly scope: Scope;
  readonly from: string;
  readonly head: GitOid;
  readonly fromHead: GitOid;
  readonly resolutions: readonly ConflictResolution[];
  readonly expectedVersion: number;
};

function parseStages(tokens: readonly string[]): readonly ConflictStage[] {
  const files = new Map<string, Map<number, string>>();
  for (const token of tokens) {
    const match = /^(\d+) ([0-9a-f]{40}) ([123])[\t ]([\s\S]+)$/.exec(token);
    if (!match) fail("MERGE_OUTPUT_INVALID", 500, "Git returned invalid conflict stages");
    const object = match[2];
    const stage = Number(match[3]);
    const path = ProjectPathSchema.parse(match[4]);
    if (!object || !Number.isInteger(stage)) fail("MERGE_OUTPUT_INVALID", 500, "Git returned incomplete conflict stages");
    const stages = files.get(path) ?? new Map<number, string>();
    stages.set(stage, object);
    files.set(path, stages);
  }
  return [...files.entries()].map(([path, stages]) => ({ path, objects: stages }));
}

type BlobValue = { readonly text: string | null; readonly binary: boolean };
async function blobValue(repo: GitRepository, scope: Scope, object: string | undefined): Promise<BlobValue> {
  if (!object) return { text: null, binary: false };
  const text = decodeText((await objects(repo.service, scope, ["cat-file", "blob", object])).bytes);
  return { text, binary: text === null };
}

async function treeBlob(repo: GitRepository, scope: Scope, tree: string, path: string): Promise<BlobValue> {
  const listing = new TextDecoder().decode((await objects(repo.service, scope, ["ls-tree", "-z", tree, "--", path])).bytes);
  const match = /^\d+ blob ([0-9a-f]{40})\t/.exec(listing);
  return blobValue(repo, scope, match?.[1]);
}

async function conflictDto(repo: GitRepository, input: {
  readonly scope: Scope;
  readonly from: string;
  readonly head: string;
  readonly fromHead: string;
  readonly base: string;
  readonly tree: string;
  readonly stages: readonly ConflictStage[];
}): Promise<GitConflict> {
  const files = new Map((await repo.service.listFiles(input.scope)).map(file => [file.path, file.id]));
  const conflictFiles = await Promise.all(input.stages.map(async stage => {
    const values = await Promise.all([
      blobValue(repo, input.scope, stage.objects.get(1)),
      blobValue(repo, input.scope, stage.objects.get(2)),
      blobValue(repo, input.scope, stage.objects.get(3)),
      treeBlob(repo, input.scope, input.tree, stage.path),
    ]);
    const [base, ours, theirs, merged] = values;
    if (!base || !ours || !theirs || !merged) throw new TypeError("Expected four conflict values");
    const binary = values.some(value => value.binary);
    return {
      fileId: files.get(stage.path) ?? stableId(`${input.scope.projectId}:${input.scope.branch}:${stage.path}`),
      path: stage.path,
      binary,
      base: binary ? null : base.text,
      ours: binary ? null : ours.text,
      theirs: binary ? null : theirs.text,
      merged: binary ? null : merged.text,
    };
  }));
  const version = (await repo.service.getBranch(input.scope)).revision;
  const id = stableId(JSON.stringify({
    scope: input.scope, from: input.from, head: input.head, fromHead: input.fromHead,
    base: input.base, files: conflictFiles.map(file => file.path),
  }));
  return GitConflictSchema.parse({
    id, scope: input.scope, from: input.from, head: oid(input.head), fromHead: oid(input.fromHead),
    base: oid(input.base), version, files: conflictFiles,
  });
}

async function analyzeMerge(repo: GitRepository, input: {
  readonly actorId: Id; readonly scope: Scope; readonly from: string; readonly head: string;
}): Promise<MergeAnalysis> {
  await branchName(input.from);
  const fromHead = (await objects(repo.service, input.scope, [
    "rev-parse", "--verify", `refs/heads/${input.from}^{commit}`,
  ])).text;
  const base = (await compareHeads(repo, { scope: input.scope, head: input.head, upstream: fromHead })).base;
  const output = new TextDecoder().decode((await objects(
    repo.service,
    input.scope,
    ["merge-tree", "--write-tree", "--messages", "--stdin"],
    encode(`${input.head} ${fromHead}\n`),
  )).bytes);
  const tokens = output.split("\0");
  const status = tokens.shift();
  const tree = tokens.shift();
  if ((status !== "0" && status !== "1") || !tree) fail("MERGE_OUTPUT_INVALID", 500, "Git returned invalid merge output");
  if (status === "1") return { kind: "clean", tree, fromHead };
  const boundary = tokens.indexOf("");
  const stageTokens = boundary < 0 ? tokens.filter(Boolean) : tokens.slice(0, boundary);
  const stages = parseStages(stageTokens);
  if (!stages.length) fail("MERGE_CONFLICT_UNSUPPORTED", 409, "Merge has no file-level resolution surface");
  const conflict = await conflictDto(repo, { scope: input.scope, from: input.from, head: input.head,
    fromHead, base, tree, stages });
  return { kind: "conflict", tree, fromHead, base, stages, conflict };
}

async function resolvedTree(repo: GitRepository, input: {
  readonly scope: Scope;
  readonly analysis: Extract<MergeAnalysis, { readonly kind: "conflict" }>;
  readonly resolutions: ResolveBody["resolutions"];
}): Promise<string> {
  const byPath = new Map(input.resolutions.map(resolution => [resolution.path, resolution]));
  if (byPath.size !== input.analysis.stages.length
    || input.analysis.stages.some(stage => !byPath.has(stage.path))) {
    fail("MERGE_RESOLUTION_INCOMPLETE", 422, "Resolve every conflicted file exactly once");
  }
  const root = await mkdtemp(join(tmpdir(), "quire-git-merge-"));
  try {
    const path = join(root, "objects.git");
    await run({ args: ["init", "--bare", path] });
    const env = { GIT_INDEX_FILE: join(root, "index") };
    const remote = (args: readonly string[], bytes?: Uint8Array) => objects(repo.service, input.scope, args, bytes);
    const local = async (args: readonly string[], bytes?: Uint8Array) => {
      try {
        return await run({ path, args, env, ...(bytes ? { input: bytes } : {}) });
      } catch (error) {
        if (error instanceof Error) {
          fail("MERGE_RESOLUTION_FAILED", 409, `${args[0] ?? "git"}: ${error.message}`);
        }
        throw error;
      }
    };
    const base = await copyTree(remote, local, input.analysis.tree);
    await local(["read-tree", base], undefined);
    for (const stage of input.analysis.stages) {
      const resolution = byPath.get(stage.path);
      if (!resolution) fail("MERGE_RESOLUTION_INCOMPLETE", 422, "Missing conflict resolution");
      if (resolution.choice === "delete") {
        await local(["update-index", "--force-remove", "--", stage.path]);
        continue;
      }
      const bytes = resolution.choice === "text"
        ? new TextEncoder().encode(resolution.text)
        : (await remote(["cat-file", "blob", stage.objects.get(resolution.choice === "ours" ? 2 : 3)
          ?? fail("MERGE_RESOLUTION_UNAVAILABLE", 422, `No ${resolution.choice} version for ${stage.path}`)])).bytes;
      const blob = (await local(["hash-object", "-w", "--stdin"], bytes)).text;
      await local(["update-index", "--add", "--cacheinfo", `100644,${blob},${stage.path}`]);
    }
    return await copyTree(local, remote, (await local(["write-tree"])).text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function merge(repo: GitRepository, actorId: Id, input: {
  readonly scope: Scope; readonly head: GitOid; readonly expectedVersion: number;
  readonly from: string; readonly key: string;
}, lease: BranchLease) {
  const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex");
  await repo.service.authorize(actorId, input.scope, "git.merge");
  const cached = await previousReceipt(repo, actorId, { key: input.key, digest });
  if (cached) return { kind: "merged" as const, operation: cached };
  const state = await repo.check(actorId, input, lease);
  if (state.hunks.length) fail("DIRTY_BROWSER", 409, "Commit or discard browser changes before merging");
  const analysis = await analyzeMerge(repo, { actorId, scope: input.scope, from: input.from, head: state.head });
  if (analysis.kind === "conflict") return { kind: "conflict" as const, conflict: analysis.conflict };
  await treeInputs(repo.service, { scope: input.scope, commit: analysis.tree });
  const after = await repo.commitTree(actorId, {
    scope: input.scope, tree: analysis.tree, parents: [state.head, analysis.fromHead],
    message: `Merge ${input.from}`,
  });
  const result = gitReceipt({ key: input.key, digest, kind: "git-merge", result: { head: oid(after) } });
  await repo.journal.publish(actorId, [
    { scope: input.scope, before: state.head, after, hydrate: true },
  ], [lease], result);
  return { kind: "merged" as const, operation: result.operation };
}

export async function resolveConflict(repo: GitRepository, actorId: Id, input: {
  readonly conflictId: Id; readonly body: ResolveBody; readonly key: string;
}, lease: BranchLease): Promise<Operation> {
  const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex");
  const cached = await previousReceipt(repo, actorId, { key: input.key, digest });
  if (cached) return cached;
  const state = await repo.check(actorId, input.body, lease);
  if (state.hunks.length) fail("DIRTY_BROWSER", 409, "Commit or discard browser changes before resolving a merge");
  const analysis = await analyzeMerge(repo, {
    actorId, scope: input.body.scope, from: input.body.from, head: state.head,
  });
  if (analysis.kind !== "conflict" || analysis.conflict.id !== input.conflictId
    || oid(analysis.fromHead) !== input.body.fromHead) {
    fail("STALE_CONFLICT", 409, "Merge conflict changed; reopen the merge");
  }
  const tree = await resolvedTree(repo, {
    scope: input.body.scope, analysis, resolutions: input.body.resolutions,
  });
  await treeInputs(repo.service, { scope: input.body.scope, commit: tree });
  const after = await repo.commitTree(actorId, {
    scope: input.body.scope, tree, parents: [state.head, analysis.fromHead],
    message: `Merge ${input.body.from}`,
  });
  const result = gitReceipt({
    key: input.key, digest, kind: "git-merge-resolve", result: { head: oid(after), conflictId: input.conflictId },
  });
  await repo.journal.publish(actorId, [
    { scope: input.body.scope, before: state.head, after, hydrate: true },
  ], [lease], result);
  return result.operation;
}
