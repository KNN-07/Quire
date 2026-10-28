import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { MutationAdmission } from "@quire/contracts";
import { ServiceError } from "./errors";

const authority = new AsyncLocalStorage<FileHandle>();
/** Git inherits the live open-file-description lock through actual child exit. */
export function nativeAdmissionDescriptor(): number | undefined { return authority.getStore()?.fd; }

async function lock(path: string, exclusive: boolean, blocking = exclusive): Promise<FileHandle> {
  const file = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    // This helper exchanges no bytes. Avoid the Bun 1.3 Node shim's lazy pipe
    // readers and their epoll lifetime entirely; only inherit the owned lock fd.
    const child = Bun.spawn(["flock", exclusive ? "--exclusive" : "--shared", ...(blocking ? [] : ["--nonblock"]), "0"],
      { stdin: file.fd, stdout: "ignore", stderr: "ignore" });
    const code = await child.exited;
    if (code !== 0) {
      const contended = code === 1 && !blocking;
      throw new ServiceError(contended ? "BACKUP_MAINTENANCE" : "NATIVE_ADMISSION_FAILED", 503,
        contended ? "Source writes are paused for backup" : `Native flock exited ${code}`);
    }
    return file;
  } catch (error) { await file.close(); throw error; }
}

/** All native roles sharing a source directory use these kernel-owned locks. */
export class NativeMutationAdmission implements MutationAdmission {
  constructor(private readonly dataDir: string) {}
  writer<T>(work: () => Promise<T>): Promise<T> { return this.acquire(work, false); }
  background<T>(work: () => Promise<T>): Promise<T> { return this.acquire(work, true); }
  private async acquire<T>(work: () => Promise<T>, blocking: boolean): Promise<T> {
    const gate = await lock(join(this.dataDir, ".admission-gate.lock"), false, blocking);
    let writers: FileHandle;
    try { writers = await lock(join(this.dataDir, ".admission-writers.lock"), false); }
    finally { await gate.close(); }
    try { return await authority.run(writers, work); }
    finally { await writers.close(); }
  }
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const gate = await lock(join(this.dataDir, ".admission-gate.lock"), true);
    try {
      const writers = await lock(join(this.dataDir, ".admission-writers.lock"), true);
      try { return await authority.run(writers, work); }
      finally { await writers.close(); }
    } finally { await gate.close(); }
  }
}
