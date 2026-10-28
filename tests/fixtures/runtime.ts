import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, loadConfig } from "@quire/runtime";

export async function isolatedData() {
  const path = await mkdtemp(join(tmpdir(), "quire-contract-"));
  const config = loadConfig({ QUIRE_DATA_DIR: path });
  return { path, config, [Symbol.asyncDispose]: () => rm(path, { recursive: true, force: true }) };
}
export async function runtimeFixture() {
  const sandbox = await isolatedData();
  const runtime = await createRuntime(sandbox.config);
  return {
    ...runtime,
    [Symbol.asyncDispose]: async () => { await runtime.close(); await sandbox[Symbol.asyncDispose](); },
  };
}
