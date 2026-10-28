import type { ModuleContext } from "@quire/runtime";
import { CoreProjects } from "../base";
import { GitRepository } from "./repository";
import { registerRepositoryRoutes } from "./routes";
import { registerHttp } from "./http";

export { migrations } from "./migrations";
export { GitRepository } from "./repository";
export { GitJournal } from "./journal";
export { serveGitSession } from "./session";
export { registerCredentials, credentialHash, tokenActor, sshFingerprint, sshActor } from "./credentials";
export async function register(context: ModuleContext): Promise<void> {
  const projects = context.services.get("projects");
  if (!(projects instanceof CoreProjects)) throw new TypeError("Git module requires the durable core project writer");
  const repo = new GitRepository(projects);
  await repo.journal.recover();
  registerRepositoryRoutes(context, repo);
  registerHttp(context, repo);
}
