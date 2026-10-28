import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { BackupError } from "./model";

export async function ownedPath(root: string, path: string): Promise<string> {
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new BackupError("BACKUP_ROOT_PERMISSIONS", "Backup/restore roots must be private real directories (0700)");
  }
  const base = await realpath(root);
  const target = resolve(base, path);
  const suffix = relative(base, target);
  if (!suffix || suffix.startsWith("..") || isAbsolute(suffix)) {
    throw new BackupError("BACKUP_PATH_DENIED", "Use a child of the configured private root");
  }
  // Only a direct child is accepted: no attacker-controlled intermediate symlinks.
  if (dirname(target) !== base) throw new BackupError("BACKUP_PATH_DENIED", "Use a direct child of the configured private root");
  return target;
}
export async function readRegular(path: string): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new BackupError("BACKUP_FILE_INVALID", path);
    return new Uint8Array(await handle.readFile());
  } finally { await handle.close(); }
}
export async function writeDurable(path: string, bytes: Uint8Array | string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function inventory(path: string, prefix = ""): Promise<readonly string[]> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new BackupError("BACKUP_FILE_INVALID", path);
  const result: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await inventory(join(path, entry.name), name + "/"));
    else if (entry.isFile()) result.push(name);
    else throw new BackupError("BACKUP_FILE_INVALID", name);
  }
  return result.sort();
}
