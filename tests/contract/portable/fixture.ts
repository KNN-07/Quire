import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig } from "@quire/runtime";
import type { Runtime, RuntimeOptions } from "@quire/runtime";
import { InstantSchema } from "@quire/contracts";
import type { Clock } from "@quire/contracts";

export async function fixture(options: RuntimeOptions = {}): Promise<{
  readonly runtime: Runtime; readonly root: string; readonly close: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "quire-p1s-contract-"));
  try {
    const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: root }), options);
    return { runtime, root, close: async () => {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
      console.info("fixture.cleaned", root);
    } };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
export function barrier(): { readonly promise: Promise<void>; readonly release: () => void } {
  const value = Promise.withResolvers<void>();
  return { promise: value.promise, release: () => { value.resolve(); } };
}
export function fixedClock(): { readonly clock: Clock; readonly advance: (ms: number) => void } {
  let time = Date.parse("2026-10-27T00:00:00.000Z");
  return {
    clock: { now: () => InstantSchema.parse(new Date(time).toISOString()) },
    advance: (ms) => { time += ms; },
  };
}
