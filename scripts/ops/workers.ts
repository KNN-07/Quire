import { createHmac } from "node:crypto";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { createRuntime, loadConfig } from "@quire/runtime";
import { createScaleAdapters } from "../../apps/server/src/scale";
import { WorkerController, migrations } from "../../services/operations/workers";
import { assertUncontrolledEntrypoint } from "../../services/operations/installation/launch";

/** Run after the API's complete schema migration, with the same storage authority. */
export async function workersMain(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await assertUncontrolledEntrypoint(env);
  const config = loadConfig(env);
  const coordinator = z.url({ protocol: /^https?$/ }).parse(env["QUIRE_COORDINATOR_URL"]);
  const runtime = await createRuntime(config, {
    modules: [{ id: "080-o-workers", lane: "O", order: 80, migrations, register: () => undefined }],
    ...(config.profile === "scale" ? { createAdapters: createScaleAdapters } : {}),
  });
  const bearer = createHmac("sha256", runtime.secretKey).update("quire:compiler:worker:v1").digest("hex");
  const controller = new WorkerController({ ...runtime, routes: runtime.routes.forLane("O") }, {
    coordinator, bearer, ...(env["QUIRE_WORKER_ENVIRONMENT_IDS"]
      ? { environmentIds: env["QUIRE_WORKER_ENVIRONMENT_IDS"].split(",").map(id => IdSchema.parse(id)) } : {}),
  });
  const stopped = Promise.withResolvers<void>();
  const stop = () => stopped.resolve();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  controller.addEventListener("failure", stop, { once: true });
  try {
    await controller.start();
    await stopped.promise;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    try { await controller.close(); } finally { await runtime.close(); }
  }
}
if (import.meta.main) await workersMain();
