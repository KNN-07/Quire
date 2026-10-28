import type { Id, Scope, GitStatus, GitOid, BranchLease } from "@quire/contracts";
import { GitStatusSchema } from "@quire/contracts";
import type { CoreProjects } from "../base";
import { repositoryPath } from "../base";
import { fail, compare } from "../base/store";
import { GitJournal } from "./journal";
import { objects, encode, raw, oid, zero } from "./process";
import { diffHunks } from "./hunks";
import { branchRelation } from "./status";

export class GitRepository {
  readonly journal: GitJournal;
  constructor(readonly service: CoreProjects) { this.journal = new GitJournal(service); }
  path(scope: Scope) { return repositoryPath(this.service.context, scope.projectId); }
  async head(actorId: Id, scope: Scope, lease: BranchLease): Promise<string> {
    const current = await objects(this.service, scope, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/"]);
    const named = current.text.split("\n").find(row => row.startsWith(`refs/heads/${scope.branch} `))?.split(" ")[1];
    if (named) return named;
    const project = await this.service.getProject(scope.projectId);
    if (scope.branch !== project.defaultBranch) fail("NOT_FOUND", 404, "Branch does not exist");
    // Named initial history is a fresh root, never a hidden checkpoint commit.
    const snapshot = await this.live(actorId, scope, lease);
    const commit = await this.commitTree(actorId, { scope, tree: raw(snapshot.tree), parents: [], message: "Initial source" });
    await this.journal.publish(actorId, [{ scope, before: zero, after: commit, hydrate: false }], [lease], undefined, { initial: true });
    return commit;
  }
  async live(actorId: Id, scope: Scope, lease: BranchLease) {
    const revision = (await this.service.getBranch(scope)).revision;
    const existing = await this.service.context.db.get<{ id: Id }>(
      "SELECT id FROM snapshots WHERE project_id=? AND branch=? AND revision=? ORDER BY created_at DESC,id DESC LIMIT 1",
      [scope.projectId, scope.branch, revision]);
    if (existing) return this.service.getSnapshot(existing.id);
    return this.service.commitSource({ actorId, scope, lease, expectedRevision: revision,
      inputs: (await this.service.listFiles(scope)).map(file => ({ file })), advance: false });
  }
  async inspect(actorId: Id, scope: Scope, lease: BranchLease) {
    await this.service.authorize(actorId, scope, "git.read");
    const head = await this.head(actorId, scope, lease);
    const snapshot = await this.live(actorId, scope, lease);
    const hunks = await diffHunks(this.service, { actorId, scope, head, tree: raw(snapshot.tree) });
    const headPaths = (await objects(this.service, scope, ["ls-tree", "-rz", head])).text;
    const livePaths = new Set((await this.service.listFiles(scope)).map(file => file.path));
    const unique = [...new Map(hunks.map(item => [item.hunk.path, item.hunk])).values()];
    const relation = await branchRelation(this, scope, head);
    const status: GitStatus = GitStatusSchema.parse({
      head: oid(head), branch: scope.branch, ...relation,
      files: unique.map(hunk => ({ fileId: hunk.fileId, path: hunk.path,
        status: !livePaths.has(hunk.path) ? "deleted" : !headPaths.includes(`\t${hunk.path}\0`) ? "added" : "modified" })),
      hunks: hunks.map(item => item.hunk), staged: hunks.filter(item => item.hunk.staged).map(item => item.hunk.id),
    });
    return { status, hunks, snapshot, head };
  }
  async check(actorId: Id, input: { readonly scope: Scope; readonly head: GitOid; readonly expectedVersion: number }, lease: BranchLease) {
    await this.service.authorize(actorId, input.scope, "git.write");
    compare((await this.service.getBranch(input.scope)).revision, input.expectedVersion);
    const state = await this.inspect(actorId, input.scope, lease);
    if (state.status.head !== input.head) fail("STALE_HEAD", 409, "Named branch has changed");
    return state;
  }
  async commitTree(actorId: Id, input: {
    readonly scope: Scope; readonly tree: string; readonly parents: readonly string[]; readonly message: string;
  }) {
    const author = await this.service.readUser(actorId);
    const identity = `${author.name.replace(/[<>\r\n]/g, "")} <${author.primaryEmail.replace(/[<>\r\n]/g, "")}> ${Math.floor(Date.parse(this.service.context.clock.now()) / 1000)} +0000`;
    const commit = `tree ${input.tree}\n${input.parents.map(parent => `parent ${parent}\n`).join("")}author ${identity}\ncommitter ${identity}\n\n${input.message.trimEnd()}\n`;
    return (await objects(this.service, input.scope, ["hash-object", "-w", "-t", "commit", "--stdin"], encode(commit))).text;
  }
}
