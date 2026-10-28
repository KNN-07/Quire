import type { Scope } from "@quire/contracts";
import type { GitRepository } from "./repository";
import { objects } from "./process";

type CommitGraph = ReadonlyMap<string, readonly string[]>;

async function graph(repo: GitRepository, scope: Scope, heads: readonly string[]): Promise<CommitGraph> {
  const text = (await objects(repo.service, scope, [
    "log", "--topo-order", "--format=%H%x00%P%x1e", ...heads,
  ])).text;
  return new Map(text.split("\x1e").filter(row => row.trim()).map(row => {
    const [commit, parents = ""] = row.trimStart().split("\0");
    if (!commit) throw new TypeError("Git returned an empty commit graph row");
    return [commit, parents.split(" ").filter(Boolean)];
  }));
}

function distances(commits: CommitGraph, start: string): ReadonlyMap<string, number> {
  const result = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const commit = queue[index];
    if (!commit) continue;
    const distance = result.get(commit);
    if (distance === undefined) continue;
    for (const parent of commits.get(commit) ?? []) {
      if (result.has(parent)) continue;
      result.set(parent, distance + 1);
      queue.push(parent);
    }
  }
  return result;
}

export async function compareHeads(repo: GitRepository, input: {
  readonly scope: Scope; readonly head: string; readonly upstream: string;
}) {
  const commits = await graph(repo, input.scope, [input.head, input.upstream]);
  const head = distances(commits, input.head);
  const upstream = distances(commits, input.upstream);
  const common = [...head.keys()].filter(commit => upstream.has(commit)).sort((left, right) => {
    const leftScore = Math.max(head.get(left) ?? Number.MAX_SAFE_INTEGER, upstream.get(left) ?? Number.MAX_SAFE_INTEGER);
    const rightScore = Math.max(head.get(right) ?? Number.MAX_SAFE_INTEGER, upstream.get(right) ?? Number.MAX_SAFE_INTEGER);
    return leftScore - rightScore;
  })[0];
  if (!common) throw new TypeError("Git branches do not share ancestry");
  return {
    base: common,
    ahead: [...head.keys()].filter(commit => !upstream.has(commit)).length,
    behind: [...upstream.keys()].filter(commit => !head.has(commit)).length,
  };
}
