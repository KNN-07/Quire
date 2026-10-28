import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "./model";
import { BackupError } from "./model";
import { readRegular } from "./files";

export async function gitCommand(path: string, args: readonly string[], input?: Uint8Array): Promise<Uint8Array> {
  const child = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "--git-dir", path, ...args], {
    stdin: input ?? "ignore", stdout: "pipe", stderr: "pipe",
    signal: AbortSignal.timeout(300000),
    env: { PATH: process.env["PATH"], GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  });
  const output = new Response(child.stdout).bytes();
  const error = new Response(child.stderr).text();
  const [bytes, message, code] = await Promise.all([output, error, child.exited]);
  if (code !== 0) throw new BackupError("BACKUP_GIT_INVALID", `git ${args[0]} exited ${code}: ${message}`);
  return bytes;
}
export async function verifyRepositories(archive: string, manifest: Manifest): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-backup-verify-"));
  try {
    for (const repository of manifest.repositories) {
      const path = join(root, `${repository.projectId}.git`);
      await gitCommand(path, ["init", "--bare", "--initial-branch=main", path]);
      await gitCommand(path, ["index-pack", "--stdin", "--strict"],
        await readRegular(join(archive, `repositories/${repository.projectId}.pack`)));
      if (repository.refs.length) await gitCommand(path, ["update-ref", "--stdin"], new TextEncoder().encode(
        repository.refs.map(ref => `create ${ref.ref} ${ref.oid.slice(5)}\n`).join("")));
      await gitCommand(path, ["fsck", "--full", "--strict", "--no-reflogs"]);
      const objects = new TextDecoder().decode(await gitCommand(path,
        ["cat-file", "--batch-all-objects", "--batch-check=%(objectname)"])).trim();
      if ((objects ? objects.split("\n").length : 0) !== repository.objects) {
        throw new BackupError("BACKUP_GIT_INVALID", "Object catalog count differs from manifest");
      }
    }
  } finally { await rm(root, { recursive: true }); }
}
