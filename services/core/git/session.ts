import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Id } from "@quire/contracts";
import { fail } from "../base/store";
import { sshActor } from "./credentials";
import type { GitRepository } from "./repository";
import { publicRepository, publishPush } from "./transport";

async function currentSshActor(repo: GitRepository, fingerprint: string): Promise<Id> {
  const actorId = await sshActor(repo.service.context, fingerprint);
  if (!actorId) fail("GIT_AUTH_REQUIRED", 401, "Current SSH key required");
  return actorId;
}

export async function serveGitSession(repo: GitRepository, input: {
  readonly fingerprint: string;
  readonly projectId: Id;
  readonly service: "git-upload-pack" | "git-receive-pack";
  readonly run: (path: string) => Promise<void>;
}): Promise<void> {
  return repo.service.context.admission.writer(async () => {
    const actorId = await currentSshActor(repo, input.fingerprint);
    const project = await repo.service.getProject(input.projectId);
    const scope = { projectId: input.projectId, branch: project.defaultBranch };
    const receive = input.service === "git-receive-pack";
    await repo.service.authorize(actorId, scope, receive ? "git.push" : "git.read");
    await repo.service.serialized(scope, lease => repo.head(actorId, scope, lease));
    const root = await mkdtemp(join(tmpdir(), receive ? "quire-git-ssh-quarantine-" : "quire-git-ssh-public-"));
    const path = join(root, `${input.projectId}.git`);
    try {
      const original = await publicRepository(repo, scope, path);
      await input.run(path);
      if (receive) await publishPush(repo, actorId, {
        scope,
        path,
        original,
        currentActor: () => currentSshActor(repo, input.fingerprint),
        authorization: { sshFingerprint: input.fingerprint },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
