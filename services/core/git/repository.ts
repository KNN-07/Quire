import type { Id, Scope, GitStatus, GitOid } from "@quire/contracts";
import { GitStatusSchema } from "@quire/contracts";
import type { CoreProjects } from "../base";
import { repositoryPath } from "../base";
import { fail, compare } from "../base/store";
import { GitJournal } from "./journal";
import { run, raw, oid, zero } from "./process";
import { diffHunks } from "./hunks";

export class GitRepository {
  readonly journal: GitJournal;
  constructor(readonly service: CoreProjects) { this.journal = new GitJournal(service); }
  path(scope: Scope) { return repositoryPath(this.service.context, scope.projectId); }
  async head(actorId: Id, scope: Scope): Promise<string> {
    const path = this.path(scope);
    const current = await run({ path, args: ["rev-parse", "--verify", `refs/heads/${scope.branch}`], allowed: [0, 128] });
    if (current.code === 0) return current.text;
    const project = this.service.getProject(scope.projectId);
    if (scope.branch !== project.defaultBranch) fail("NOT_FOUND", 404, "Branch does not exist");
    // Named initial history is a fresh root, never a hidden checkpoint commit.
    const snapshot = await this.live(actorId, scope);
    const commit = await this.commitTree(actorId, { scope, tree: raw(snapshot.tree), parents: [], message: "Initial source" });
    await this.journal.publish(actorId, [{ scope, before: zero, after: commit, hydrate: false }]);
    return commit;
  }
  live(actorId: Id, scope: Scope) {
    return this.service.commitSource({ actorId, scope, expectedRevision: this.service.getBranch(scope).revision,
      inputs: this.service.listFiles(scope).map(file => ({ file })), advance: false });
  }
  async inspect(actorId: Id, scope: Scope) {
    await this.service.authorize(actorId, scope, "git.read");
    const head = await this.head(actorId, scope);
    const snapshot = await this.live(actorId, scope);
    const hunks = await diffHunks(this.service, { actorId, scope, head, tree: raw(snapshot.tree) });
    const headPaths = (await run({ path: this.path(scope), args: ["ls-tree", "-rz", head] })).text;
    const livePaths = new Set(this.service.listFiles(scope).map(file => file.path));
    const unique = [...new Map(hunks.map(item => [item.hunk.path, item.hunk])).values()];
    const status: GitStatus = GitStatusSchema.parse({
      head: oid(head), branch: scope.branch, ahead: 0, behind: 0,
      files: unique.map(hunk => ({ fileId: hunk.fileId, path: hunk.path,
        status: !livePaths.has(hunk.path) ? "deleted" : !headPaths.includes(`\t${hunk.path}\0`) ? "added" : "modified" })),
      hunks: hunks.map(item => item.hunk), staged: hunks.filter(item => item.hunk.staged).map(item => item.hunk.id),
    });
    return { status, hunks, snapshot, head };
  }
  async check(actorId: Id, input: { readonly scope: Scope; readonly head: GitOid; readonly expectedVersion: number }) {
    await this.service.authorize(actorId, input.scope, "git.write");
    compare(this.service.getBranch(input.scope).revision, input.expectedVersion);
    const state = await this.inspect(actorId, input.scope);
    if (state.status.head !== input.head) fail("STALE_HEAD", 409, "Named branch has changed");
    return state;
  }
  async commitTree(actorId: Id, input: {
    readonly scope: Scope; readonly tree: string; readonly parents: readonly string[]; readonly message: string;
  }) {
    const author = this.service.readUser(actorId);
    return (await run({ path: this.path(input.scope),
      args: ["-c", `user.name=${author.name}`, "-c", `user.email=${author.primaryEmail}`,
        "commit-tree", input.tree, ...input.parents.flatMap(parent => ["-p", parent]), "-m", input.message],
      env: { GIT_AUTHOR_DATE: this.service.context.clock.now(), GIT_COMMITTER_DATE: this.service.context.clock.now() } })).text;
  }
}
