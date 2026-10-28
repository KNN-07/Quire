import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

const assets = [
  "pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip",
  "pyodide-lock.json", "package.json", "README.md",
] as const;

export async function installPythonAssets() {
  const source = resolve(import.meta.dir, "../node_modules/pyodide");
  const target = resolve(import.meta.dir, "../apps/web/public/extensions/pyodide");
  const { version } = z.object({ version: z.string() }).parse(
    JSON.parse(await readFile(join(source, "package.json"), "utf8")));
  await mkdir(target, { recursive: true });
  for (const asset of assets) await copyFile(join(source, asset), join(target, asset));
  await writeFile(join(target, "version.json"), JSON.stringify({ version, assets }) + "\n");
  return { version, directory: "/extensions/pyodide/", files: assets.length };
}

if (import.meta.main) console.info("PYODIDE_ASSETS_READY", await installPythonAssets());
