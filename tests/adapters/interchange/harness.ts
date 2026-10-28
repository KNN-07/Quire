import { baseFixture } from "../../core/base/harness";
import { createInterchangeModule } from "../../../services/adapters/interchange";
import type { PandocConverter } from "../../../services/adapters/interchange";
import type { SafeHttpClient } from "../../../services/adapters/shared";
import { ServiceError, migrateDatabase } from "@quire/runtime";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function retainEvidence(name: string, bytes: Uint8Array): Promise<void> {
  const directory = Bun.env["QUIRE_INTERCHANGE_EVIDENCE"];
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await Bun.write(join(directory, name), bytes);
}

export async function rejectionCode(work: Promise<unknown>): Promise<string> {
  try { await work; }
  catch (error) {
    if (error instanceof ServiceError) return error.code;
    throw error;
  }
  throw new TypeError("Expected operation to reject");
}

export async function interchangeFixture(options: {
  readonly converter?: PandocConverter; readonly http?: SafeHttpClient;
} = {}) {
  const base = await baseFixture();
  const interchange = createInterchangeModule(options);
  const register = async () => {
    await migrateDatabase(base.runtime.uow, interchange.module.migrations ?? []);
    await interchange.module.register({ ...base.runtime, routes: base.runtime.routes.forLane("X") });
  };
  try { await register(); }
  catch (error) { await base[Symbol.asyncDispose](); throw error; }
  return {
    ...base,
    get runtime() { return base.runtime; },
    get service() { return base.service; },
    async restart() { await base.restart(); await register(); },
    async [Symbol.asyncDispose]() { await interchange.close(); await base[Symbol.asyncDispose](); },
  };
}
