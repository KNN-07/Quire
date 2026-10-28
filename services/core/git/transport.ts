import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BranchLease, Id, Scope } from "@quire/contracts";
import { fail } from "../base/store";
import type { GitRepository } from "./repository";
import { encode, run, zero } from "./process";
import { treeInputs } from "./trees";
import type { RefChange } from "./journal";

export async function refs(path: string): Promise<ReadonlyMap<string, string>> {
  const text = (await run({ path, args: ["for-each-ref", "--format=%(refname) %(objectname)"] })).text;
  return new Map(text.split("\n").filter(Boolean).map(row => {
    const [name, head] = row.split(" ");
    if (!name || !head) fail("INVALID_REF", 500, "Invalid ref listing");
    return [name, head];
  }));
}

async function withScopes<T>(
  repo: GitRepository,
  scopes: readonly Scope[],
  work: (leases: readonly BranchLease[]) => Promise<T>,
  leases: readonly BranchLease[] = [],
): Promise<T> {
  const [scope, ...rest] = scopes;
  return scope ? repo.service.serialized(scope, lease => withScopes(repo, rest, work, [...leases, lease])) : work(leases);
}

/** Build a physically separate object store containing only finalized named ancestry. */
export async function publicRepository(repo: GitRepository, scope: Scope, path: string): Promise<ReadonlyMap<string, string>> {
  const bundle = await repo.service.context.repositories.exportNamed(scope.projectId);
  await run({ path, args: ["init", "--bare", `--initial-branch=${scope.branch}`, path] });
  if (bundle.byteLength) {
    const bundlePath = join(path, "..", "named.bundle");
    await writeFile(bundlePath, bundle);
    await run({ path, args: ["fetch", "--no-tags", "--no-write-fetch-head", bundlePath, "+refs/heads/*:refs/heads/*"] });
  }
  return refs(path);
}

export async function publishPush(repo: GitRepository, actorId: Id, input: {
  readonly scope: Scope;
  readonly path: string;
  readonly original: ReadonlyMap<string, string>;
  readonly currentActor: () => Promise<Id>;
  readonly authorization: { readonly tokenHash?: string; readonly sshFingerprint?: string };
}): Promise<void> {
  const proposed = await refs(input.path);
  const changes: RefChange[] = [];
  for (const name of new Set([...input.original.keys(), ...proposed.keys()])) {
    const before = input.original.get(name) ?? zero;
    const after = proposed.get(name) ?? zero;
    if (before === after) continue;
    if (!name.startsWith("refs/heads/")) fail("GIT_REF_FORBIDDEN", 403, "Only named branches may be pushed");
    const branch = name.slice("refs/heads/".length);
    if (after === zero && branch === input.scope.branch) fail("DEFAULT_BRANCH", 409, "Cannot delete default branch");
    if (after !== zero) {
      await run({ path: input.path, args: ["cat-file", "-e", `${after}^{commit}`] });
      await treeInputs(repo.service, { scope: { ...input.scope, branch }, path: input.path, commit: after });
    }
    changes.push({ scope: { ...input.scope, branch }, before, after, hydrate: after !== zero });
  }
  if (!changes.length) return;
  await run({ path: input.path, args: ["fsck", "--strict", "--no-reflogs"] });
  await withScopes(repo, changes.map(change => change.scope).sort((a, b) => a.branch.localeCompare(b.branch)), async leases => {
    if (await input.currentActor() !== actorId) fail("GIT_AUTH_REQUIRED", 401, "Current Git credential required");
    for (const change of changes) {
      const exists = await repo.service.context.db.get("SELECT 1 FROM branch_workspaces WHERE project_id=? AND branch=?",
        [change.scope.projectId, change.scope.branch]);
      await repo.service.authorize(actorId, exists ? change.scope : input.scope, "git.push");
      if (exists) {
        const lease = leases.find(item => item.scope.branch === change.scope.branch);
        if (!lease) fail("GIT_LEASE_REQUIRED", 500, "Push branch fence missing");
        const state = await repo.inspect(actorId, change.scope, lease);
        if (state.hunks.length) fail("DIRTY_BROWSER", 409, "Browser has uncommitted edits; push a separate branch");
        if (state.head !== change.before) fail("STALE_HEAD", 409, "Branch moved during push");
      }
    }
    const heads = [...proposed.values()];
    if (heads.length) {
      const pack = await run({ path: input.path, args: ["pack-objects", "--stdout", "--revs"],
        input: encode(`${heads.join("\n")}\n`) });
      await repo.service.context.repositories.importPack(input.scope.projectId, pack.bytes);
    }
    if (await input.currentActor() !== actorId) fail("GIT_AUTH_REQUIRED", 401, "Current Git credential required");
    await repo.service.authorize(actorId, input.scope, "git.push");
    await repo.journal.publish(actorId, changes, leases, undefined, input.authorization);
  });
}
