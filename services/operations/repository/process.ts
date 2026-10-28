import { mkdir, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { StorageError } from "@quire/runtime";

/** flock locks the inherited open file description, retained by our FileHandle. */
export async function ownVolume(volume: string): Promise<FileHandle> {
  await mkdir(volume, { recursive: true, mode: 0o700 });
  const handle = await open(join(volume, ".repository-owner.lock"), "a+", 0o600);
  try {
    const child = Bun.spawn(["flock", "--exclusive", "--nonblock", "0"],
      { stdin: handle.fd, stdout: "ignore", stderr: "ignore" });
    const code = await child.exited;
    if (code !== 0) throw new StorageError(code === 1 ? "REPOSITORY_VOLUME_OWNED" : "REPOSITORY_LOCK_FAILED", volume);
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

export type GitRunner = (path: string, args: readonly string[], input?: Uint8Array) => Promise<Uint8Array>;

export function gitRunner(owner: FileHandle, command: readonly string[] = ["git"]): GitRunner {
  return async (path, args, input) => {
    // fd 3 retains volume exclusion if the service crashes before Git exits.
    const [executable, ...prefix] = command;
    if (!executable) throw new StorageError("REPOSITORY_GIT_REQUIRED", "Missing Git executable");
    const child = Bun.spawn([executable, ...prefix, "-c", "core.hooksPath=/dev/null", "--git-dir", path, ...args], {
      stdio: [input === undefined ? "ignore" : new Blob([new Uint8Array(input)]), "pipe", "pipe", owner.fd],
      env: {
        PATH: process.env["PATH"], GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Quire", GIT_AUTHOR_EMAIL: "quire@localhost",
        GIT_COMMITTER_NAME: "Quire", GIT_COMMITTER_EMAIL: "quire@localhost",
      },
    });
    try {
      const [output, error, code] = await Promise.all([
        new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited,
      ]);
      if (code !== 0) throw new StorageError("REPOSITORY_GIT_FAILED", `${args[0]}: ${error.trim()}`);
      return new Uint8Array(output);
    } finally { await child.exited; }
  };
}
