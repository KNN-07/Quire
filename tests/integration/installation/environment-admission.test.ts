import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { CompileJobSchema, EnvironmentSchema, IdSchema, OperationSchema, ProjectSchema, endpoints } from "@quire/contracts";
import { ExecutionLaunchSchema } from "../../../services/operations/installation/execution-model";
import { InstallationStateSchema } from "../../../services/operations/installation/model";
import { ProbeReportSchema, ManifestInputSchema } from "../../../services/operations/environments/model";
import { proposeEnvironmentAdmission } from "../../../scripts/ops/environment-admission";
import { controlDigest } from "../../../services/operations/installation/protocol";
import { fixtureIds } from "../../fixtures/foundation";
import { startEditorWeb } from "../../ui-editor/shared/web-server";
import { startEditorBrowser } from "../../ui-editor/shared/browser";
import { admissionBrowser } from "../../ui-product/environment-admission/browser";
import { nativeInstallation, password } from "./native-fixture";

function sql<T>(root: string, file: string, select: (database: Database) => T): T {
  const database = new Database(join(root, file), { readonly: true });
  try { database.exec("PRAGMA busy_timeout=5000"); return select(database); }
  finally { database.close(); }
}
function observe<T>(root: string, select: () => T | null, seconds = 300) {
  const result = Promise.withResolvers<T>();
  const observer = watch(root, (_event, file) => { if (file?.startsWith("quire.sqlite")) check(); });
  const timer = setTimeout(() => result.reject(new Error("Admission SQL event timed out")), seconds * 1000);
  const close = () => { observer.close(); clearTimeout(timer); };
  void result.promise.then(close, close);
  void result.promise.catch(() => undefined);
  function check() {
    try { const value = select(); if (value !== null) result.resolve(value); }
    catch (error) { result.reject(error); }
  }
  check();
  return { promise: result.promise, check, close };
}
function launches(root: string) {
  return sql(root, "control.sqlite", database => {
    if (!database.query("SELECT name FROM sqlite_master WHERE name='execution_launches'").get()) return [];
    return z.array(z.object({ record_json: z.string() })).parse(database.query("SELECT record_json FROM execution_launches").all())
      .map(row => ExecutionLaunchSchema.parse(JSON.parse(row.record_json)));
  });
}
function worker(root: string, environmentId: string, previous?: string) {
  return observe(root, () => sql(root, "quire.sqlite", database => {
    const rows = z.array(z.object({ id: IdSchema, environment_ids_json: z.string() })).parse(database.query(
      `SELECT p.id,p.environment_ids_json FROM o_worker_processes p JOIN workers w ON w.id=p.id
       WHERE p.exited_at IS NULL AND p.pid IS NOT NULL AND w.state IN ('idle','busy')`).all());
    return rows.find(row => row.id !== previous && z.array(z.string()).parse(JSON.parse(row.environment_ids_json)).includes(environmentId)) ?? null;
  }));
}

test("built custom image requires an explicit next signed release before managed worker PDF use, and revocation removes admission", async () => {
  const evidence = `docs/evidence/p27-custom-environment/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  const base = z.array(EnvironmentSchema).parse(JSON.parse(await readFile(
    "docs/evidence/p2o-environments/worker-environments.json", "utf8")))[0];
  if (!base) throw new Error("Missing accepted base environment");
  const images = new Set<string>();
  let installationRoot = "";
  let webRoot = "";
  {
    await using resources = new AsyncDisposableStack();
    webRoot = await mkdtemp(join(tmpdir(), "quire-p27-web-"));
    resources.defer(() => rm(webRoot, { recursive: true }));
    const allocator = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
    const apiPort = allocator.port;
    await allocator.stop(true);
    if (!apiPort) throw new Error("No API port");
    const web = await startEditorWeb(resolve("apps/web"), join(webRoot, "vite"), `http://127.0.0.1:${apiPort}`);
    resources.defer(() => web.close());
    resources.defer(async () => {
      for (const image of images) {
        if (image === base.rootOrImageDigest) throw new Error("Refusing shared image cleanup");
        const process = Bun.spawn(["docker", "image", "rm", image], { stdout: "pipe", stderr: "pipe" });
        const [code, stdout, stderr] = await Promise.all([process.exited,
          new Response(process.stdout).text(), new Response(process.stderr).text()]);
        console.info("P27_IMAGE_CLEANUP", { image, code, stdout, stderr });
        expect(code, stderr).toBe(0);
      }
    });
    const owned = resources.use(await nativeInstallation({ workerEnvironment: base, apiPort, publicUrl: web.url.origin,
      migrationSql: "CREATE TABLE installation_update_probe(value TEXT NOT NULL);" }));
    installationRoot = owned.root;
    console.info("P27_OWNED", { evidence, installationRoot, webRoot, apiPort, origin: web.url.origin,
      installationId: owned.config.installationId });
    if (owned.prior.data.dialect !== "sqlite") throw new Error("Expected native generation");
    const root = owned.prior.data.dataRoot;
    const first = worker(root, base.id);
    resources.defer(first.close);
    const browser = resources.use(await startEditorBrowser());
    const url = `http://127.0.0.1:${apiPort}`;
    const origin = web.url.origin;
    async function login(email: string) {
      const response = await fetch(`${url}/api/auth/login`, { method: "POST",
        headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(10000) });
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      if (!cookie) throw new Error("Missing actual login cookie");
      const me = await fetch(`${url}/api/me`, { headers: { cookie, origin } });
      const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
      return { cookie, origin, "x-csrf-token": csrf };
    }
    const json = async (path: string, headers: Record<string, string>, body?: unknown) => {
      const response = await fetch(`${url}${path}`, { method: body === undefined ? "GET" : "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
      const value: unknown = await response.json();
      return { status: response.status, value };
    };
    try {
      await owned.start();
      const originalWorker = await first.promise;
      const user = await login("kien@quire.local");
      const operator = await login("operator@quire.local");
      let buildId: string | null = null;
      const built = observe(root, () => buildId === null ? null : sql(root, "quire.sqlite", database => {
        const row = z.object({ status: z.string(), error_code: z.string().nullable(), result_json: z.string().nullable() })
          .parse(database.query("SELECT status,error_code,result_json FROM operations WHERE id=?").get(buildId));
        return ["queued", "running"].includes(row.status) ? null : row;
      }));
      resources.defer(built.close);
      const submitted = await json("/api/admin/environments/build", operator, {
        baseId: base.id, packageList: [], fontUploads: [], mirror: "https://archive.ubuntu.com/ubuntu/",
      });
      expect(submitted.status, JSON.stringify(submitted.value)).toBe(202);
      buildId = z.object({ data: OperationSchema }).parse(submitted.value).data.id;
      built.check();
      const completed = await built.promise;
      expect(completed.status, JSON.stringify(completed)).toBe("succeeded");
      const output = z.object({ environmentId: IdSchema, image: z.string(), available: z.literal(true) })
        .parse(JSON.parse(completed.result_json ?? "null"));
      images.add(output.image);
      const stored = sql(root, "quire.sqlite", database => z.object({ manifest_json: z.string(), report_json: z.string() })
        .parse(database.query(`SELECT e.manifest_json,r.report_json FROM environments e
          JOIN environment_receipts r ON r.environment_id=e.id WHERE e.id=?`).get(output.environmentId)));
      const environment = EnvironmentSchema.parse(JSON.parse(stored.manifest_json));
      const report = ProbeReportSchema.parse(JSON.parse(stored.report_json));
      expect(report.checks.every(check => check.code === 0)).toBe(true);
      const inspect = Bun.spawn(["docker", "image", "inspect", output.image], { stdout: "pipe", stderr: "pipe" });
      const [inspectExit, inspectOutput, inspectError] = await Promise.all([inspect.exited,
        new Response(inspect.stdout).text(), new Response(inspect.stderr).text()]);
      expect(inspectExit, inspectError).toBe(0);
      expect(z.array(z.object({ Id: z.string() })).parse(JSON.parse(inspectOutput))[0]?.Id).toBe(output.image);
      await writeFile(`${evidence}/image-inspect.json`, inspectOutput);
      await writeFile(`${evidence}/build-probes.json`, JSON.stringify({ operationId: buildId, completed, environment, report }, null, 2));
      const status = async () => {
        const response = await json(endpoints.environmentsAdmission.path, user);
        expect(response.status).toBe(200);
        return z.object({ data: endpoints.environmentsAdmission.output }).parse(response.value).data;
      };
      const before = (await status()).find(item => item.environment.id === environment.id);
      expect(before).toMatchObject({ probe: "ready", selectable: false, execution: { state: "not-admitted" } });
      const projectResponse = await json(`/api/projects/${fixtureIds.project}?branch=main`, user);
      const project = z.object({ data: ProjectSchema }).parse(projectResponse.value).data;
      const compileInput = { scope: { projectId: project.id, branch: "main" }, expectedRevision: 0,
        settings: { ...project.settings, environmentId: environment.id }, clean: true };
      const denied = await json(`/api/projects/${project.id}/compiles`, user, compileInput);
      expect(denied.status).toBe(409);
      expect(denied.value).toMatchObject({ error: { code: "ENVIRONMENT_NOT_ADMITTED" } });
      const deniedDefault = await json(`/api/admin/environments/${environment.id}/default`, operator, { expectedVersion: before?.version });
      expect(deniedDefault.status).toBe(409);
      expect(deniedDefault.value).toMatchObject({ error: { code: "ENVIRONMENT_NOT_ADMITTED" } });
      const unbuiltId = IdSchema.parse(crypto.randomUUID());
      const unbuilt = await json("/api/admin/environments", operator, { manifest: {
        ...ManifestInputSchema.parse(environment), id: unbuiltId, rootOrImageDigest: `sha256:${"f".repeat(64)}`,
      } });
      expect(unbuilt.status).toBeGreaterThanOrEqual(400);
      expect(sql(root, "quire.sqlite", db => db.query("SELECT id FROM environments WHERE id=?").get(unbuiltId))).toBeNull();
      await admissionBrowser({ browser: browser.browser, url: web.url.origin, userCookie: user.cookie,
        operatorCookie: operator.cookie, environment, directory: evidence, admitted: false });
      const build = launches(owned.roots.control).find(row => row.request.work.kind === "environment-build" && row.result?.image === output.image);
      if (!build) throw new Error("No controller-owned successful build receipt");
      const input = { manifest: owned.manifest, environment, report, build,
        controllerRole: "worker-controller", workerRole: "compiler-worker",
        sourceProfileId: "worker-docker-default", profileId: "worker-custom-admitted" };
      expect(() => proposeEnvironmentAdmission({ ...input, build: { ...build, result: null } })).toThrow("ADMISSION_BUILD_PROOF_REQUIRED");
      const proposal = proposeEnvironmentAdmission(input);
      const candidate = owned.publishAdmission(proposal.manifest);
      await writeFile(`${evidence}/admission-input.json`, JSON.stringify(input, null, 2));
      await writeFile(`${evidence}/admission-proposal.json`, JSON.stringify(proposal, null, 2));
      await writeFile(`${evidence}/signed-release.json`, JSON.stringify(candidate, null, 2));
      const active = owned.activatedAfter(0);
      const promoted = owned.receiptWhen(row => ["succeeded", "failed"].includes(row.operation.status) || row.operation.errorCode !== null);
      const replacement = worker(root, environment.id, originalWorker.id);
      resources.defer(replacement.close);
      const promotion = await json("/api/admin/updates", operator, {
        releaseId: candidate.release.id, at: new Date(Date.now() + 60000).toISOString(), autoSecurity: false,
      });
      expect(promotion.status, JSON.stringify(promotion.value)).toBe(202);
      const receipt = await promoted;
      expect(receipt.operation.status, JSON.stringify(receipt)).toBe("succeeded");
      await active;
      const next = await replacement.promise;
      expect(next.id).not.toBe(originalWorker.id);
      const admitted = (await status()).find(item => item.environment.id === environment.id);
      expect(admitted).toMatchObject({ probe: "ready", selectable: true, execution: {
        state: "admitted", releaseId: candidate.release.id,
        route: { workerRole: "compiler-worker", profileIds: ["worker-custom-admitted"] },
      } });
      const wrongRoleId = IdSchema.parse(crypto.randomUUID());
      const wrongRole = await json("/api/admin/environments", operator, {
        manifest: { ...ManifestInputSchema.parse(environment), id: wrongRoleId },
      });
      expect(wrongRole.status).toBeGreaterThanOrEqual(400);
      expect(sql(root, "quire.sqlite", db => db.query("SELECT id FROM environments WHERE id=?").get(wrongRoleId))).toBeNull();
      await admissionBrowser({ browser: browser.browser, url: web.url.origin, userCookie: user.cookie,
        operatorCookie: operator.cookie, environment, directory: evidence, admitted: true });
      let jobId: string | null = null;
      const finished = observe(root, () => jobId === null ? null : sql(root, "quire.sqlite", database => {
        const row = z.object({ status: z.string(), failure_code: z.string().nullable() })
          .parse(database.query("SELECT status,failure_code FROM compile_jobs WHERE id=?").get(jobId));
        return ["queued", "running"].includes(row.status) ? null : row;
      }));
      resources.defer(finished.close);
      const compile = await json(`/api/projects/${project.id}/compiles`, user, {
        scope: compileInput.scope, expectedRevision: 0, clean: true,
      });
      expect(compile.status, JSON.stringify(compile.value)).toBe(202);
      jobId = z.object({ data: CompileJobSchema }).parse(compile.value).data.id;
      finished.check();
      expect(await finished.promise).toEqual({ status: "succeeded", failure_code: null });
      const job = z.object({ data: CompileJobSchema }).parse((await json(`/api/compiles/${jobId}`, user)).value).data;
      expect(job.environmentId).toBe(environment.id);
      expect(job.workerId).toBe(next.id);
      const pdf = job.artifacts.find(artifact => artifact.name === "output.pdf");
      if (!pdf) throw new Error("No actual PDF");
      const bytes = new Uint8Array(await (await fetch(`${url}/api/artifacts/${pdf.id}/content`, { headers: user })).arrayBuffer());
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
      expect(controlDigest(bytes)).toBe(pdf.sha256);
      await writeFile(`${evidence}/custom-output.pdf`, bytes);
      const consumed = launches(owned.roots.control).filter(row => row.profile.id === "worker-custom-admitted");
      expect(consumed.some(row => row.request.work.kind === "compile" && row.result?.code === 0)).toBe(true);
      expect(consumed.every(row => row.profile.image === environment.rootOrImageDigest &&
        row.binding.release.releaseId === candidate.release.id && row.profile.roles.length === 1 &&
        row.profile.roles[0] === "compiler-worker")).toBe(true);
      await writeFile(`${evidence}/adoption.json`, JSON.stringify({
        candidate, receipt, environment, originalWorker, next, admitted, consumed, job, pdfHash: controlDigest(bytes),
      }, null, 2));
      console.info("P27_SIGNED_ADOPTION_PDF", { releaseId: candidate.release.id, sequence: candidate.release.sequence,
        environmentId: environment.id, workerId: next.id, jobId: job.id, pdfHash: controlDigest(bytes) });
      const state = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
      expect(state.binding.release.releaseId).toBe(candidate.release.id);
      expect(state.floor).toEqual({ version: "2.0.0", sequence: 2 });
      const nextTargets = await owned.provisionNextNativeTargets();
      await writeFile(`${evidence}/target-provisioning.json`, JSON.stringify(nextTargets, null, 2));
      const revokedManifest = { ...proposal.manifest,
        roles: proposal.manifest.roles.map(role => role.environmentIds
          ? { ...role, environmentIds: role.environmentIds.filter(id => id !== environment.id) } : role),
        executionProfiles: proposal.manifest.executionProfiles?.filter(profile => profile.id !== "worker-custom-admitted"),
      };
      const revokedRelease = owned.publishAdmission(revokedManifest, 3);
      const reactivated = owned.activatedAfter(state.generation);
      const revocationDone = owned.receiptWhen(row => row.operation.id !== receipt.operation.id &&
        (["succeeded", "failed"].includes(row.operation.status) || row.operation.errorCode !== null));
      const revocation = await json("/api/admin/updates", operator, {
        releaseId: revokedRelease.release.id, at: new Date(Date.now() + 60000).toISOString(), autoSecurity: false,
      });
      expect(revocation.status, JSON.stringify(revocation.value)).toBe(202);
      const revokedReceipt = await revocationDone;
      expect(revokedReceipt.operation.status, JSON.stringify(revokedReceipt)).toBe("succeeded");
      await reactivated;
      const revoked = (await status()).find(item => item.environment.id === environment.id);
      const revokedState = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
      expect(revokedState.binding.release.releaseId).toBe(revokedRelease.release.id);
      expect(revokedState.floor).toEqual({ version: "3.0.0", sequence: 3 });
      expect(revoked).toMatchObject({ probe: "ready", selectable: false,
        execution: { state: "not-admitted", releaseId: revokedRelease.release.id } });
      const revokedCompile = await json(`/api/projects/${project.id}/compiles`, user, compileInput);
      expect(revokedCompile.status).toBe(409);
      expect(revokedCompile.value).toMatchObject({ error: { code: "ENVIRONMENT_NOT_ADMITTED" } });
      const proof = { evidence, installationRoot, webRoot, installationId: owned.config.installationId,
        buildId, environment, inspectExit, before, denied, deniedDefault, unbuilt, wrongRole,
        receipt, originalWorker, next, admitted, consumed, job, pdfHash: controlDigest(bytes),
        state, nextTargets, revokedRelease, revokedReceipt, revokedState, revoked, revokedCompile };
      await writeFile(`${evidence}/proof.json`, JSON.stringify(proof, null, 2));
      console.info("P27_CUSTOM_ENVIRONMENT_PROOF", JSON.stringify(proof));
    } finally {
      const executions = launches(owned.roots.control);
      for (const execution of executions) if (execution.request.work.kind === "environment-build" && execution.result?.image) images.add(execution.result.image);
      await writeFile(`${evidence}/execution-ledger.json`, JSON.stringify(executions, null, 2));
      const control = sql(owned.roots.control, "control.sqlite", database => ({
        state: database.query("SELECT state_json FROM installation").all(),
        commands: database.query("SELECT receipt_json FROM commands").all(),
        executions: database.query("SELECT record_json FROM executions").all(),
        intents: database.query("SELECT record_json FROM execution_intents").all(),
        stopped: database.query("SELECT evidence_json FROM stopped_cohorts").all(),
      }));
      await writeFile(`${evidence}/control-receipts.json`, JSON.stringify(control, null, 2));
      console.info("P27_EXECUTION_LEDGER", JSON.stringify(executions));
    }
  }
  expect(await stat(installationRoot).then(() => true, () => false)).toBe(false);
  expect(await stat(webRoot).then(() => true, () => false)).toBe(false);
  await writeFile(`${evidence}/cleanup.json`, JSON.stringify({ installationRoot, webRoot, removedImages: [...images], rootsAbsent: true }, null, 2));
  console.info("P27_CLEANUP_COMPLETE", { installationRoot, webRoot, images: [...images], evidence });
}, 1200000);
