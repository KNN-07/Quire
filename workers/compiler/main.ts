import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { nativeEnvironmentId } from "../../services/compiler/environment";
import { runRemoteWorker } from "./remote";

export async function workerMain(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const config = z.strictObject({
      baseUrl: z.url({ protocol: /^https?$/ }),
      bearer: z.string().regex(/^[a-f0-9]{64}$/),
      workerId: IdSchema, environmentIds: z.array(IdSchema).min(1),
    }).parse({
      baseUrl: env["QUIRE_COORDINATOR_URL"], bearer: env["QUIRE_WORKER_BEARER"],
      workerId: env["QUIRE_WORKER_ID"] ?? crypto.randomUUID(),
      environmentIds: env["QUIRE_WORKER_ENVIRONMENT_IDS"]?.split(",") ?? [nativeEnvironmentId],
    });
    await runRemoteWorker({ ...config, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError" && controller.signal.aborted) return;
    if (!(error instanceof Error)) throw error;
    console.error("compiler.worker.failed", { code: error instanceof ServiceError ? error.code : error.name });
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
if (import.meta.main) await workerMain();
