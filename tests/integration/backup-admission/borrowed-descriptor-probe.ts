import { mkdtemp, open, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A module-rooted set controls when completed native subprocesses become collectible.
const retained = new Set<{ readonly exited: Promise<number> }>();
async function inspect(file: FileHandle): Promise<"open" | "EBADF"> {
  try { await file.stat(); return "open"; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EBADF") return "EBADF";
    throw error;
  }
}
async function close(file: FileHandle): Promise<"closed" | "EBADF"> {
  try { await file.close(); return "closed"; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EBADF") return "EBADF";
    throw error;
  }
}

const mode = process.argv[2] ?? "plain";
const root = await mkdtemp(join(tmpdir(), "quire-borrowed-descriptor-"));
try {
  const prior = await (async () => {
    const owner = await open(join(root, "owner"), "w+", 0o600);
    const fd = owner.fd;
    switch (mode) {
      case "plain": break;
      case "stdin": {
        const child = Bun.spawn(["flock", "--shared", "0"], { stdin: fd, stdout: "ignore", stderr: "ignore" });
        retained.add(child);
        if (await child.exited !== 0) throw new Error("Actual flock failed");
        break;
      }
      case "extra": {
        const child = Bun.spawn(["git", "--version"], { stdio: ["ignore", "ignore", "ignore", fd] });
        retained.add(child);
        if (await child.exited !== 0) throw new Error("Actual Git failed");
        break;
      }
      default: throw new Error(`Unknown descriptor probe mode: ${mode}`);
    }
    const beforeClose = await inspect(owner);
    const ownerClose = await close(owner);
    return { fd, beforeClose, ownerClose };
  })();
  const files: FileHandle[] = [];
  let sentinel: FileHandle;
  for (;;) {
    const file = await open(join(root, `sentinel-${files.length}`), "w+", 0o600);
    files.push(file);
    if (file.fd === prior.fd) { sentinel = file; break; }
    if (file.fd > prior.fd) throw new Error(`Descriptor ${prior.fd} was not available for controlled reuse`);
  }
  const beforeGc = await inspect(sentinel);
  retained.clear();
  Bun.gc(true);
  const afterGc = await inspect(sentinel);
  const cleanup = await Promise.all(files.map(close));
  console.info(JSON.stringify({ bun: Bun.version, mode, ...prior, beforeGc, afterGc, cleanup }));
  if (prior.beforeClose !== "open" || prior.ownerClose !== "closed" || beforeGc !== "open" ||
      afterGc !== "open" || cleanup.includes("EBADF")) process.exitCode = 1;
} finally { await rm(root, { recursive: true, force: true }); }
