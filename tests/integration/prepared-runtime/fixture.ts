import { Database } from "bun:sqlite";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadConfig } from "@quire/runtime";
import { createApplication } from "../../../apps/server/src/composition";
import type { ApplicationOptions } from "../../../apps/server/src/composition";
import { seed } from "../../../scripts/seed";

export const password = "quire-prepared-fixture-password";

export async function fixture(options: Omit<ApplicationOptions, "config" | "startup"> = {}, seeded = false) {
  const root = await mkdtemp(join(tmpdir(), "quire-p7-prepared-"));
  const config = loadConfig({ QUIRE_DATA_DIR: root, QUIRE_COMPILER_BACKEND: "docker",
    QUIRE_PUBLIC_URL: "http://prepared.test" });
  await writeFile(join(root, "owner.json"), JSON.stringify({ owner: "st_01a17e5b", root }), { mode: 0o600 });
  try {
    const bootstrap = await createApplication({ ...options, config });
    try { if (seeded) await seed(bootstrap.runtime, password); }
    finally { await bootstrap.close(); }
    return {
      root, config,
      prepare: () => createApplication({ ...options, config, startup: "prepared" }),
      async [Symbol.asyncDispose]() {
        await rm(root, { recursive: true });
        await stat(root).then(() => { throw new Error(`Owned root survived: ${root}`); }, error => {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        });
        console.info("P7_ROOT_CLEANED", root);
      },
    };
  } catch (error) { await rm(root, { recursive: true }); throw error; }
}

/** Every persistent byte, including SQLite, Git, blobs, keys and the manifest. */
export async function fingerprint(root: string): Promise<Readonly<Record<string, string>>> {
  const paths: string[] = [];
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (!entry.name.endsWith("-shm") && !entry.name.endsWith("-wal")) paths.push(full);
    }
  }
  await walk(root);
  return Object.fromEntries(await Promise.all(paths.sort().map(async path =>
    [relative(root, path), new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex")])));
}

export function inspect(root: string) {
  return new Database(join(root, "quire.sqlite"), { readonly: true, strict: true });
}
