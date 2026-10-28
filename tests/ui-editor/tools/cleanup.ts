import { Database } from "bun:sqlite";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Only the exact project names created by this producer establish ownership.
const ownedNames = ["Tools files 1440", "Tools files 390", "Tools catalog 1440", "Tools catalog 390",
  "Symbol insertion", "Deterministic bibliography", "Link source", "Link destination", "Figure insertion",
  "Tools compact 1440", "Tools compact 390", "Rnw selector 1440", "Rnw selector 390"] as const;
const processes = await readdir("/proc", { withFileTypes: true });
const commands = await Promise.all(processes.filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name)).map(async entry => {
  try { return await readFile(`/proc/${entry.name}/cmdline`, "utf8"); }
  catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ESRCH" || error.code === "EACCES")) return "";
    throw error;
  }
}));
for (const entry of await readdir(tmpdir(), { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^quire-ui-editor-[a-zA-Z0-9]+$/.test(entry.name)) continue;
  const root = join(tmpdir(), entry.name);
  if (commands.some(command => command.includes(root))) continue;
  const path = join(root, "quire.sqlite");
  if (!await Bun.file(path).exists()) continue;
  const database = new Database(path, { readonly: true, create: false });
  let owned = false;
  try {
    const projects = database.query<{ readonly name: string }, []>("SELECT name FROM projects").all();
    owned = projects.some(project => ownedNames.some(name => project.name === name));
  } finally { database.close(); }
  if (!owned) continue;
  await rm(root, { force: true, recursive: true });
  console.info("TOOLS_REMOVED_INACTIVE_OWNED_ROOT", root);
}
console.info("TOOLS_CLEANUP_RECEIPT=0");
