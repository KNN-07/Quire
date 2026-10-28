import { lstat, mkdir, open, readFile, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { UpdateError } from "./model";
import type { ReleasePackage, SignedRelease, UpdateConfig } from "./model";

export type InstallReceipt = { readonly prior: string; readonly staged: string; readonly entrypoint: string };
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
/** This owns only a pre-provisioned dedicated root, never the running source checkout. */
export class OwnedInstaller {
  constructor(readonly config: UpdateConfig) {}
  async validate(): Promise<void> {
    const root = this.config.installRoot;
    if (resolve(root) !== root || await realpath(root) !== root || root === "/" ||
      !(await lstat(join(root, ".quire-update-root"))).isFile() ||
      await readFile(join(root, ".quire-update-root"), "utf8") !== this.config.installId) {
      throw new UpdateError("INSTALL_ROOT_NOT_OWNED");
    }
    const releases = join(root, "releases");
    if (!(await lstat(releases)).isDirectory() || await realpath(releases) !== releases) {
      throw new UpdateError("UNSAFE_RELEASE_DIRECTORY");
    }
    await this.current();
  }
  async current(): Promise<string> {
    const target = await readlink(join(this.config.installRoot, "current"));
    if (!/^releases\/[a-zA-Z0-9_-]+$/.test(target)) throw new UpdateError("UNSAFE_CURRENT_TARGET");
    const path = join(this.config.installRoot, target);
    if (!(await lstat(path)).isDirectory() || await realpath(path) !== path) throw new UpdateError("UNSAFE_CURRENT_TARGET");
    return target;
  }
  async lock(operationId: string): Promise<() => Promise<void>> {
    await this.validate();
    const lock = join(this.config.installRoot, ".update-lock");
    await writeFile(lock, operationId, { flag: "wx", mode: 0o600 });
    return () => rm(lock);
  }
  async recoverLock(operationId: string): Promise<void> {
    await this.validate();
    const lock = join(this.config.installRoot, ".update-lock");
    let owner: string;
    try { owner = await readFile(lock, "utf8"); }
    catch (error) {
      // Explicit recovery may resume after its prior lock removal succeeded.
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    if (owner !== operationId) throw new UpdateError("RECOVERY_LOCK_MISMATCH");
    await rm(lock);
  }
  async stage(release: SignedRelease, pack: ReleasePackage): Promise<InstallReceipt> {
    const prior = await this.current();
    const staged = `releases/${release.sequence}-${release.packageDigest}-${crypto.randomUUID()}`;
    const destination = join(this.config.installRoot, staged);
    await mkdir(destination);
    const directories = new Set([destination]);
    try {
      for (const file of pack.files) {
        const path = join(destination, file.path);
        await mkdir(dirname(path), { recursive: true });
        for (let directory = dirname(path); directory !== destination; directory = dirname(directory)) directories.add(directory);
        const handle = await open(path, "wx", file.executable ? 0o700 : 0o600);
        try { await handle.writeFile(Buffer.from(file.data, "base64")); await handle.sync(); }
        finally { await handle.close(); }
      }
      for (const directory of [...directories].sort((a, b) => b.length - a.length)) await syncDirectory(directory);
      await syncDirectory(join(this.config.installRoot, "releases"));
      return { prior, staged, entrypoint: pack.entrypoint };
    } catch (error) {
      await rm(destination, { recursive: true });
      throw error;
    }
  }
  async activate(target: string): Promise<void> {
    if (!/^releases\/[a-zA-Z0-9_-]+$/.test(target)) throw new UpdateError("UNSAFE_SWITCH_TARGET");
    const temporary = join(this.config.installRoot, `.switch-${crypto.randomUUID()}`);
    await symlink(target, temporary);
    try { await rename(temporary, join(this.config.installRoot, "current")); }
    catch (error) { await rm(temporary); throw error; }
    await syncDirectory(this.config.installRoot);
  }
}
