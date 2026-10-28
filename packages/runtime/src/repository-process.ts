import { resolve } from "node:path";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { StorageError } from "./errors";
import { nativeAdmissionDescriptor } from "./native-admission";

export function nativeRepositoryPath(dataDir: string, projectId: Id): string {
  return resolve(dataDir, "git", `${IdSchema.parse(projectId)}.git`);
}
export async function repositoryGit(path: string, args: readonly string[], input?: Uint8Array): Promise<Uint8Array> {
  const descriptor = nativeAdmissionDescriptor();
  const child = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "--git-dir", path, ...args], {
    stdio: [input === undefined ? "ignore" : new Blob([new Uint8Array(input)]),
      "pipe", "pipe", ...(descriptor === undefined ? [] : [descriptor])],
    env: { PATH: process.env["PATH"], GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Quire", GIT_AUTHOR_EMAIL: "quire@localhost",
      GIT_COMMITTER_NAME: "Quire", GIT_COMMITTER_EMAIL: "quire@localhost" },
  });
  try {
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new StorageError("REPOSITORY_GIT_FAILED", `${args[0]}: ${error.trim()}`);
    return new Uint8Array(output);
  } finally {
    // A stream failure must not release admission while Git can still mutate.
    await child.exited;
  }
}
// Shared by every native adapter for this durable repository, not by request.
const queues = new Map<string, Promise<unknown>>();
export async function serializedRepository<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve();
  const next = previous.then(work);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(path, settled);
  try { return await next; }
  finally { if (queues.get(path) === settled) queues.delete(path); }
}
