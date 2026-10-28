import { strict as assert } from "node:assert";
import { IdSchema } from "@quire/contracts";
import type { CompileJob } from "@quire/contracts";
import type { Runtime } from "@quire/runtime";
import { startWorker, stopWorker } from "../../../services/compiler";
import { fixtureIds as ids } from "../../fixtures/foundation";

/** Execute real confined TeX; terminal subscription exists before enqueue. */
export async function compileForDrill(runtime: Runtime) {
  const terminal = Promise.withResolvers<string>();
  const deadline = setTimeout(() => terminal.reject(new Error("Actual compile terminal event deadline")), 180000);
  const unsubscribe = runtime.events.subscribe(event => {
    if (event.topic === "job.changed" && event.aggregateId === ids.project &&
        ["succeeded", "failed", "timeout", "canceled"].includes(event.payload.status)) {
      terminal.resolve(event.payload.resourceId);
    }
  });
  let job: CompileJob;
  try {
    await startWorker(runtime);
    await runtime.services.get("compiler").enqueue(ids.kien,
      { scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0, clean: true }, crypto.randomUUID());
    job = await runtime.services.get("compiler").get(ids.kien, IdSchema.parse(await terminal.promise));
    assert.equal(job.status, "succeeded", job.failureCode ?? "Actual compiler failed");
  } finally { clearTimeout(deadline); unsubscribe(); await stopWorker(runtime); }
  const pdf = job.artifacts.find(artifact => artifact.kind === "pdf");
  assert.ok(pdf);
  const bytes = await runtime.blobs.get(pdf.sha256);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  return { pdf, bytes };
}
