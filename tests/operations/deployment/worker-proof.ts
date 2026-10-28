import { createHmac } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import { z } from "zod";
import ky from "ky";
import { checked } from "../../../deploy/runtime/artifacts";
import { ProbeReportSchema } from "../../../services/operations/environments/model";
import { manifestFromProbe } from "../../../services/operations/environments/probe";

if (import.meta.main) {
  const values = Object.fromEntries((await readFile("/tmp/quire-p2o-deployment-compose/runtime.env", "utf8"))
    .trim().split("\n").map(line => line.split("=", 2)));
  const key = z.string().regex(/^[a-f0-9]{64}$/).parse(values["QUIRE_SECRET_KEY"]);
  const bearer = createHmac("sha256", Buffer.from(key, "hex")).update("quire:compiler:worker:v1").digest("hex");
  const workerId = crypto.randomUUID();
  const mode = z.enum(["native", "docker"]).parse(process.argv[2] ?? "native");
  const manifestPath = { native: undefined, docker: "/tmp/quire-p2o-deployment-compose/worker-images.json" }[mode];
  let environmentId = "00000000-0000-4000-8000-000000000030";
  if (manifestPath) {
    const report = ProbeReportSchema.parse(await Bun.file("docs/evidence/p2o-environments/default-report.json").json());
    if (!report.available || report.checks.some(check => check.code !== 0)) throw new Error("Producer's image probe has not passed");
    const manifest = manifestFromProbe({ id: crypto.randomUUID(), label: "Deployment verified image", report });
    environmentId = manifest.id;
    await writeFile(manifestPath, JSON.stringify([manifest]), { mode: 0o600, flag: "wx" });
    await writeFile("docs/evidence/p2o-deployment/consumed-environment.json", JSON.stringify(manifest, null, 2));
  }
  const observed = Promise.withResolvers<void>();
  // Subscribe at the wire before starting the real worker. This forwards the
  // actual authenticated request to the deployed coordinator, not a fake lease.
  const gateway = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const forwarded = new Request(`http://127.0.0.1:43182${url.pathname}${url.search}`, request);
      const response = await ky(forwarded, { retry: 0, timeout: 15_000, throwHttpErrors: false });
      if (url.pathname === "/internal/workers/lease") {
        if (response.ok) {
          z.object({ data: z.object({ lease: z.null() }) }).parse(await response.clone().json());
          observed.resolve();
        } else observed.reject(new Error(`Deployed worker lease rejected: ${response.status} ${await response.clone().text()}`));
      }
      return response;
    },
  });
  const child = Bun.spawn([process.execPath, "workers/compiler/main.ts"], {
    env: {
      ...process.env, QUIRE_COORDINATOR_URL: gateway.url.toString(),
      QUIRE_WORKER_BEARER: bearer, QUIRE_WORKER_ID: workerId,
      QUIRE_WORKER_ENVIRONMENT_IDS: environmentId,
      ...(manifestPath ? { QUIRE_WORKER_ENVIRONMENTS_FILE: manifestPath } : {}),
    },
    stdout: "pipe", stderr: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  void child.exited.then(async code => observed.reject(new Error(`Worker exited ${code}: ${await stderr}`)));
  const timeout = setTimeout(() => observed.reject(new Error("Real worker registration timed out")), 300_000);
  try {
    await observed.promise;
    const rows = await checked(["docker", "exec", "quire-p2o-deployment-postgres-1", "psql", "-U", "quire",
      "-d", "quire", "-At", "-c", `SELECT id,state,last_heartbeat FROM workers WHERE id='${workerId}'`]);
    if (!rows.startsWith(`${workerId}|idle|`)) throw new Error(`Real worker heartbeat missing: ${rows}`);
    console.info(JSON.stringify({ workerId, row: rows, actualProbe: mode, actualDeployedLease: true,
      jobCompiled: false, reason: "Environment image admission and profile artifact validation belong to their producer" }));
  } finally {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    await child.exited;
    await stdout;
    await stderr;
    await gateway.stop(true);
    if (manifestPath) await rm(manifestPath);
  }
  const exit = await child.exited;
  if (exit !== 0) throw new Error(`Worker shutdown exit ${exit}: ${await stderr}`);
}
