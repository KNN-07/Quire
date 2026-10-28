import { createHmac } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import ky from "ky";
import { z } from "zod";
import { CompileJobSchema, EnvironmentSchema, ProjectSchema } from "@quire/contracts";
import { checked } from "../../../deploy/runtime/artifacts";
import { ManifestInputSchema, ProbeReportSchema, digest } from "../../../services/operations/environments/model";

if (import.meta.main) {
  const state = z.object({ projectId: z.uuid(), fileId: z.uuid(), cookie: z.string() })
    .parse(await Bun.file("/tmp/quire-p2o-deployment-compose/compose-proof.json").json());
  const environment = EnvironmentSchema.parse(await Bun.file("docs/evidence/p2o-deployment/consumed-environment.json").json());
  const report = ProbeReportSchema.parse(await Bun.file("docs/evidence/p2o-environments/default-report.json").json());
  if (!environment.available || !report.available || environment.rootOrImageDigest !== report.image) {
    throw new Error("Deployment requires the actually probed immutable image");
  }
  const base = "http://127.0.0.1:43182";
  const http = ky.create({ prefixUrl: base, retry: 0, timeout: 30_000, headers: { cookie: state.cookie } });
  const project = z.object({ data: ProjectSchema }).parse(await http.get(`api/projects/${state.projectId}?branch=main`).json()).data;
  const me = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await http.get("api/me").json());
  const sql = (statement: string) => checked(["docker", "exec", "quire-p2o-deployment-postgres-1",
    "psql", "-U", "quire", "-d", "quire", "-v", "ON_ERROR_STOP=1", "-At", "-c", statement]);
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  // Fixture enrollment preserves the producer's executed report, not invented availability.
  await sql(`INSERT INTO environments(id,label,release,backend,manifest_json,available,probe_at,created_at)
    VALUES('${environment.id}',${literal(environment.label)},${literal(environment.release)},'docker',
    ${literal(JSON.stringify(environment))},1,'${environment.probeAt}','${new Date().toISOString()}') ON CONFLICT DO NOTHING;
    INSERT INTO environment_receipts(environment_id,report_json,manifest_digest,created_by)
    VALUES('${environment.id}',${literal(JSON.stringify(report))},
    '${digest(JSON.stringify(ManifestInputSchema.parse(environment)))}','${project.ownerId}') ON CONFLICT DO NOTHING`);
  const revision = z.coerce.number().int().nonnegative().parse(await sql(
    `SELECT revision FROM snapshots WHERE project_id='${project.id}' ORDER BY created_at DESC LIMIT 1`));
  const values = Object.fromEntries((await readFile("/tmp/quire-p2o-deployment-compose/runtime.env", "utf8"))
    .trim().split("\n").map(line => line.split("=", 2)));
  const bearer = createHmac("sha256", Buffer.from(z.string().regex(/^[a-f0-9]{64}$/).parse(values["QUIRE_SECRET_KEY"]), "hex"))
    .update("quire:compiler:worker:v1").digest("hex");
  const completed = Promise.withResolvers<void>();
  let rejectedReceipts = 0;
  let acceptedPdf = false;
  const gateway = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      try {
        const url = new URL(request.url);
        const target = `${base}${url.pathname}${url.search}`;
        if (url.pathname.endsWith("/artifacts/output.pdf")) {
          const bytes = new Uint8Array(await request.clone().arrayBuffer());
          if (!request.headers.get("x-pdf-validation")) throw new Error("Actual worker omitted its PDF receipt");
          for (const receipt of [null, "0".repeat(64)]) {
            const headers = new Headers(request.headers);
            headers.delete("content-length");
            headers.set("content-type", "application/octet-stream");
            headers.delete("x-pdf-validation");
            if (receipt) headers.set("x-pdf-validation", receipt);
            const denied = await ky.put(target, { headers, body: bytes, retry: 0, throwHttpErrors: false });
            const failure = z.object({ error: z.object({ code: z.literal("PDF_VALIDATION_REQUIRED") }) });
            if (denied.status !== 422) throw new Error(`Deployed invalid receipt returned ${denied.status}: ${await denied.text()}`);
            failure.parse(await denied.json());
            rejectedReceipts++;
          }
        }
        const response = await ky(new Request(target, request), { retry: 0, timeout: 30_000, throwHttpErrors: false });
        if (!response.ok) throw new Error(`Deployed worker request ${url.pathname}: ${response.status} ${await response.text()}`);
        if (url.pathname.endsWith("/artifacts/output.pdf")) acceptedPdf = true;
        if (url.pathname.endsWith("/complete")) completed.resolve();
        return response;
      } catch (error) {
        completed.reject(error);
        return new Response("Deployment proof failed", { status: 500 });
      }
    },
  });
  const manifestPath = "/tmp/quire-p2o-deployment-compose/pdf-worker-environments.json";
  const workerId = crypto.randomUUID();
  let worker: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  let output: Promise<string> | undefined;
  let errors: Promise<string> | undefined;
  const deadline = setTimeout(() => completed.reject(new Error("Deployed PDF acceptance timed out")), 360_000);
  try {
    const job = z.object({ data: CompileJobSchema }).parse(await http.post(`api/projects/${project.id}/compiles`, {
      headers: { origin: base, "x-csrf-token": me.data.csrfToken, "idempotency-key": crypto.randomUUID() },
      json: { scope: { projectId: project.id, branch: "main" }, expectedRevision: revision, clean: true,
        settings: { ...project.settings, environmentId: environment.id } },
    }).json()).data;
    await writeFile(manifestPath, JSON.stringify([environment]), { mode: 0o600, flag: "wx" });
    worker = Bun.spawn([process.execPath, "workers/compiler/main.ts"], {
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, QUIRE_COORDINATOR_URL: gateway.url.toString(), QUIRE_WORKER_BEARER: bearer,
        QUIRE_WORKER_ID: workerId, QUIRE_WORKER_ENVIRONMENT_IDS: environment.id,
        QUIRE_WORKER_ENVIRONMENTS_FILE: manifestPath },
    });
    output = new Response(worker.stdout).text();
    errors = new Response(worker.stderr).text();
    void worker.exited.then(async code => completed.reject(new Error(`Worker exited ${code}: ${await errors}`)));
    await completed.promise;
    const result = z.object({ data: CompileJobSchema }).parse(await http.get(`api/compiles/${job.id}`).json()).data;
    if (result.status !== "succeeded" || !acceptedPdf || rejectedReceipts !== 2) {
      throw new Error(`Deployed job did not prove PDF acceptance: ${JSON.stringify(result)}`);
    }
    const artifact = result.artifacts.find(item => item.name === "output.pdf");
    if (!artifact) throw new Error("Actual deployed job has no PDF");
    const bytes = new Uint8Array(await http.get(`api/artifacts/${artifact.id}/content`).arrayBuffer());
    if (digest(bytes) !== artifact.sha256 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
      throw new Error("Authorized PDF download differs from the worker artifact");
    }
    await writeFile("docs/evidence/p2o-deployment/deployed-worker.pdf", bytes);
    console.info(JSON.stringify({ jobId: job.id, workerId, image: environment.rootOrImageDigest,
      rejectedReceipts, acceptedPdf, bytes: bytes.length, sha256: artifact.sha256, apiRunnerAccess: false }));
  } finally {
    clearTimeout(deadline);
    worker?.kill("SIGTERM");
    await worker?.exited;
    await output;
    await errors;
    await gateway.stop(true);
    await rm(manifestPath, { force: true });
  }
  if (worker && await worker.exited !== 0) throw new Error(`Worker shutdown ${await worker.exited}: ${await errors}`);
}
