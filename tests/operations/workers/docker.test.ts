import { test, expect } from "bun:test";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { z } from "zod";
import { EnvironmentSchema } from "@quire/contracts";
import { WorkerController } from "../../../services/operations/workers";
import { CompilerService, CompilerLeases } from "../../../services/compiler";
import { poolDirectory } from "../../../services/operations/workers/profiles";
import { ImageSchema } from "../../../services/operations/environments/model";
import { probeImage, manifestFromProbe } from "../../../services/operations/environments/probe";
import { saveEnvironment } from "../../../services/operations/environments/registry";
import { fixture, fixtureIds, observe, spawnDetail, exitDetail, jobEvent, processBudgetMs } from "./fixture";

test("Docker policy provisions a verified manifest, compiles in a real worker, and drains to zero", async () => {
  // Given an immutable image with an actually executed registry probe receipt.
  await using app = await fixture();
  const inspect = Bun.spawn(["docker", "image", "inspect",
    process.env["QUIRE_TEST_ENVIRONMENT_IMAGE"] ?? "quire-p2o-environments:st_01a17c2c", "--format", "{{.Id}}"],
    { stdout: "pipe", stderr: "pipe" });
  const [code, imageText, stderr] = await Promise.all([
    inspect.exited, new Response(inspect.stdout).text(), new Response(inspect.stderr).text(),
  ]);
  if (code !== 0) throw new TypeError(`Owned image unavailable: ${stderr}`);
  const image = ImageSchema.parse(imageText.trim());
  const report = await probeImage(image, "default");
  expect(report.available).toBe(true);
  const manifest = manifestFromProbe({ id: crypto.randomUUID(), label: "Worker pool actual Docker profile", report });
  const auth = await app.login();
  const principal = await app.runtime.services.get("identity").require(new Request(app.controller.config.coordinator, { headers: auth }));
  await saveEnvironment({ ...app.runtime, routes: app.runtime.routes.forLane("O") }, {
    manifest, report, actor: { id: principal.user.id, sessionId: principal.sessionId },
  });
  const patch = (body: unknown) => app.request("/api/admin/workers/policy", {
    method: "PATCH", headers: auth, body: JSON.stringify(body),
  });
  expect((await patch({ min: 1, max: 1, sandbox: "docker", timeoutSeconds: 60, expectedVersion: 0 })).status).toBe(200);
  const controller = new WorkerController({ ...app.runtime, routes: app.runtime.routes.forLane("O") }, {
    ...app.controller.config, environmentIds: [manifest.id],
  });
  app.trackController(controller);
  await using resources = new AsyncDisposableStack();
  resources.defer(() => controller.close());
  const spawned = observe(controller, "spawn", spawnDetail);
  const registered = observe(app.events, "registered", () => undefined);
  await controller.start();
  const role = await spawned;
  const path = `${poolDirectory(app.runtime, controller.owner)}/${role.id}/environments.json`;
  const supplied = z.array(EnvironmentSchema).parse(await Bun.file(path).json());
  expect(supplied).toEqual([manifest]);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  await registered;
  const finished = jobEvent(app.runtime, true);
  const release = Promise.withResolvers<void>();
  resources.defer(() => { release.resolve(); });
  app.gates.set("*", release.promise);
  const source = observe(app.events, "source", () => undefined);
  // When the queue selects that Docker environment for an immutable project snapshot.
  const job = await app.runtime.services.get("compiler").enqueue(fixtureIds.kien, {
    scope: { projectId: fixtureIds.project, branch: "main" }, expectedRevision: 0, clean: true,
    settings: { engine: "pdflatex", mainFileId: fixtureIds.mainFile, environmentId: manifest.id,
      draft: false, stopOnFirstError: true },
  }, crypto.randomUUID());
  await source;
  const compiler = app.runtime.services.get("compiler");
  if (!(compiler instanceof CompilerService)) throw new TypeError("Expected compiler service");
  const leases = new CompilerLeases(compiler);
  const fence = z.object({ attempt: z.number(), fencing_token: z.number() }).parse(
    await app.runtime.db.get("SELECT attempt,fencing_token FROM worker_leases WHERE job_id=?", [job.id]));
  const query = { attempt: fence.attempt, fencingToken: fence.fencing_token };
  const malformed = new TextEncoder().encode("%PDF-1.7\ninvalid");
  for (const validation of [undefined, "0".repeat(64)]) {
    const denied = await app.request(
      `/internal/jobs/${job.id}/artifacts/output.pdf?attempt=${query.attempt}&fencingToken=${query.fencingToken}`, {
        method: "PUT", body: malformed, headers: {
          authorization: `Bearer ${leases.bearer()}`,
          "x-job-capability": leases.capability(job.id, query),
          "if-match": `"v${query.fencingToken}"`,
          "x-content-sha256": new Bun.CryptoHasher("sha256").update(malformed).digest("hex"),
          ...(validation ? { "x-pdf-validation": validation } : {}),
        },
      });
    expect(denied.status).toBe(422);
    expect(await denied.json()).toMatchObject({ error: { code: "PDF_VALIDATION_REQUIRED" } });
  }
  const exited = observe(controller, "exit", exitDetail);
  expect((await patch({ min: 0, max: 0, sandbox: "docker", timeoutSeconds: 60, expectedVersion: 1 })).status).toBe(200);
  await controller.reconcile();
  expect(controller.processes.has(role.id)).toBe(true);
  release.resolve();
  // Then the actual isolated worker publishes the genuine PDF, and zero policy exits its role.
  expect((await finished(job.id)).payload).toMatchObject({ resourceId: job.id, status: "succeeded" });
  expect(await exited).toBe(role.id);
  const result = await app.runtime.services.get("compiler").get(fixtureIds.kien, job.id);
  expect(result.workerId).toBe(role.id);
  const pdf = result.artifacts.find(artifact => artifact.name === "output.pdf");
  if (!pdf) throw new TypeError("Docker worker did not publish a PDF");
  const author = await app.login("kien@quire.local");
  const response = await app.request(`/api/artifacts/${pdf.id}/content`, { headers: author });
  expect(response.status).toBe(200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(pdf.sha256);
  await mkdir("docs/evidence/p2o-workers", { recursive: true });
  await writeFile("docs/evidence/p2o-workers/docker-final.pdf", bytes);
  await writeFile("docs/evidence/p2o-workers/docker-manifest.json", JSON.stringify(supplied, null, 2) + "\n");
  expect(controller.processes.size).toBe(0);
}, processBudgetMs);
