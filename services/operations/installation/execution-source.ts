import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { ControlError } from "./model";
import { canonicalJson, controlDigest } from "./protocol";
import type { ExecutionTask } from "./execution-model";

async function inventory(source: string, maximumBytes: number, destination?: string, signal?: AbortSignal) {
  const entries: { path: string; kind: "file" | "directory"; digest?: string; bytes?: number }[] = [];
  let total = 0;
  async function visit(relative: string): Promise<void> {
    signal?.throwIfAborted();
    const path = relative ? join(source, relative) : source;
    const info = await lstat(path, { bigint: true });
    if (!info.isDirectory() || info.uid !== BigInt(process.getuid?.() ?? -1) || await realpath(path) !== path) {
      throw new ControlError("CONTROL_EXECUTION_SOURCE_INVALID");
    }
    if (destination) await mkdir(relative ? join(destination, relative) : destination, { mode: 0o755 });
    for (const name of (await readdir(path)).sort()) {
      signal?.throwIfAborted();
      if (entries.length >= 10000 || name === "." || name === "..") throw new ControlError("CONTROL_EXECUTION_SOURCE_LIMIT");
      const entry = relative ? `${relative}/${name}` : name;
      const original = join(source, entry);
      const metadata = await lstat(original, { bigint: true });
      if (metadata.isDirectory()) {
        entries.push({ path: entry, kind: "directory" });
        await visit(entry);
      } else {
        if (!metadata.isFile() || metadata.nlink !== 1n || metadata.uid !== BigInt(process.getuid?.() ?? -1)) {
          throw new ControlError("CONTROL_EXECUTION_SOURCE_INVALID");
        }
        const input = await open(original, constants.O_RDONLY | constants.O_NOFOLLOW);
        const output = destination ? await open(join(destination, entry), "wx", 0o444) : null;
        try {
          const opened = await input.stat({ bigint: true });
          if (opened.dev !== metadata.dev || opened.ino !== metadata.ino) throw new ControlError("CONTROL_EXECUTION_SOURCE_CHANGED");
          const hash = createHash("sha256");
          const buffer = Buffer.alloc(65536);
          let bytes = 0;
          for (;;) {
            signal?.throwIfAborted();
            const chunk = await input.read(buffer);
            if (chunk.bytesRead === 0) break;
            bytes += chunk.bytesRead; total += chunk.bytesRead;
            if (total > maximumBytes) throw new ControlError("CONTROL_EXECUTION_SOURCE_LIMIT");
            const data = buffer.subarray(0, chunk.bytesRead);
            hash.update(data);
            if (output) {
              let offset = 0;
              while (offset < data.byteLength) {
                const written = await output.write(data, offset, data.byteLength - offset);
                offset += written.bytesWritten;
              }
            }
          }
          const after = await input.stat({ bigint: true });
          const named = await lstat(original, { bigint: true });
          if (after.mtimeNs !== metadata.mtimeNs || after.size !== metadata.size ||
              named.dev !== metadata.dev || named.ino !== metadata.ino) throw new ControlError("CONTROL_EXECUTION_SOURCE_CHANGED");
          if (output) await output.sync();
          entries.push({ path: entry, kind: "file", bytes, digest: hash.digest("hex") });
        } finally { await input.close(); await output?.close(); }
      }
    }
    const after = await lstat(path, { bigint: true });
    if (after.dev !== info.dev || after.ino !== info.ino || after.mtimeNs !== info.mtimeNs) {
      throw new ControlError("CONTROL_EXECUTION_SOURCE_CHANGED");
    }
    if (destination) await chmod(relative ? join(destination, relative) : destination, 0o555);
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new ControlError("CONTROL_EXECUTION_SOURCE_LIMIT");
  if (await realpath(source) !== source) throw new ControlError("CONTROL_EXECUTION_SOURCE_INVALID");
  await visit("");
  return { path: source, digest: controlDigest(canonicalJson(entries.sort((a, b) => a.path.localeCompare(b.path)))) };
}
export function describeExecutionSource(path: string, maximumBytes: number) {
  return inventory(path, maximumBytes);
}
export async function sealExecutionSource(task: ExecutionTask, signal: AbortSignal): Promise<void> {
  if (!("source" in task.request.work) || !task.source) return;
  const actual = await inventory(task.request.work.source.path, task.request.limits.workspaceBytes, task.source, signal);
  if (actual.digest !== task.request.work.source.digest) throw new ControlError("CONTROL_EXECUTION_SOURCE_CHANGED");
}
/** Only call after the exact owned invocation has exited; sealed trees are intentionally read-only. */
export async function removeExecutionFiles(root: string): Promise<void> {
  async function writable(path: string): Promise<void> {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.uid !== process.getuid?.() || await realpath(path) !== path) {
      throw new ControlError("CONTROL_EXECUTION_ROOT_UNSAFE");
    }
    await chmod(path, 0o700);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await writable(join(path, entry.name));
    }
  }
  try { await writable(root); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await rm(root, { recursive: true, force: true });
}
