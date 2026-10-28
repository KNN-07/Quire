import { closeSync } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function descriptorState(file: FileHandle): Promise<"open" | "EBADF"> {
  try { await file.stat(); return "open"; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EBADF") return "EBADF";
    throw error;
  }
}

if (process.argv[2] === "--child") {
  await Bun.stdin.text();
} else {
  const root = await mkdtemp(join(tmpdir(), "quire-stdio-ownership-"));
  try {
    const result = await (async () => {
      const child = Bun.spawn([process.execPath, import.meta.path, "--child"], {
        stdio: ["pipe", "ignore", "ignore", "pipe"],
      });
      const fd = child.stdio[3];
      if (typeof fd !== "number") throw new Error("Actual extra pipe descriptor required");
      // Close the exposed pipe, then fill free slots until that exact fd number
      // belongs to an unrelated regular file. No sleep or timing retry is used.
      closeSync(fd);
      const files: FileHandle[] = [];
      let sentinel: FileHandle;
      for (;;) {
        const file = await open(join(root, `sentinel-${files.length}`), "w+", 0o600);
        files.push(file);
        if (file.fd === fd) { sentinel = file; break; }
        if (file.fd > fd) {
          await child.stdin.end();
          await child.exited;
          await Promise.all(files.map(handle => handle.close()));
          throw new Error(`The exposed descriptor was not recycled: ${fd}`);
        }
      }
      const beforeExit = await descriptorState(sentinel);
      await child.stdin.end();
      const exitCode = await child.exited;
      const afterExit = await descriptorState(sentinel);
      return { fd, files, sentinel, beforeExit, afterExit, exitCode };
    })();
    Bun.gc(true);
    const afterGc = await descriptorState(result.sentinel);
    const cleanup = await Promise.all(result.files.map(async file => {
      const fd = file.fd;
      try { await file.close(); return { fd, state: "closed" }; }
      catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EBADF") return { fd, state: "EBADF" };
        throw error;
      }
    }));
    console.info(JSON.stringify({
      bun: Bun.version, executable: process.execPath, fd: result.fd, childExit: result.exitCode,
      beforeExit: result.beforeExit, afterExit: result.afterExit, afterGc, cleanup,
    }));
    if (result.beforeExit !== "open" || result.afterExit !== "open" || afterGc !== "open" ||
        cleanup.some(file => file.state !== "closed")) process.exitCode = 1;
  } finally { await rm(root, { recursive: true, force: true }); }
}
