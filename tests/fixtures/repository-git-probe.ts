import { Database } from "bun:sqlite";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

/** A real child writer-lock probe followed by the real Git binary, not a Git mock. */
export async function probe(realGit: string, args: readonly string[]): Promise<void> {
  const directoryIndex = args.indexOf("--git-dir");
  const directory = args[directoryIndex + 1];
  const command = args[directoryIndex + 2];
  if (directoryIndex < 0 || !directory || !command) throw new Error("Missing repository command");
  const dataDir = resolve(directory, "..", "..");
  const db = new Database(resolve(dataDir, "quire.sqlite"), { strict: true });
  try {
    // Any open native UnitOfWork holds BEGIN IMMEDIATE, so this fails immediately.
    db.exec("PRAGMA busy_timeout=0");
    db.exec("BEGIN IMMEDIATE");
    db.exec("ROLLBACK");
  } finally { db.close(true); }
  await appendFile(resolve(dataDir, "git-transaction-probes.jsonl"), JSON.stringify({ command }) + "\n");
  const child = Bun.spawn([realGit, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) process.exitCode = code;
}
