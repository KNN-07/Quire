import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "@quire/runtime";

export async function isolatedData() {
  const path = await mkdtemp(join(tmpdir(), "quire-p1s-accounts-"));
  return {
    path, config: loadConfig({ QUIRE_DATA_DIR: path }),
    [Symbol.asyncDispose]: () => rm(path, { recursive: true, force: true }),
  };
}
