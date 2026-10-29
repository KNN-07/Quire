import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { EnvironmentSchema, OperationSchema, IdSchema } from "@quire/contracts";
import { ExecutionLaunchSchema } from "../../../services/operations/installation/execution-model";
import { nativeInstallation, origin, password } from "./native-fixture";

test("installed environment API builds and probes a controller-owned image before publishing it", async () => {
  const base = z.array(EnvironmentSchema).parse(JSON.parse(await readFile(
    "docs/evidence/p2o-environments/worker-environments.json", "utf8")))[0];
  if (!base) throw new Error("Missing accepted immutable environment");
  const images = new Set<string>();
  await using resources = new AsyncDisposableStack();
  resources.defer(async () => {
    for (const image of images) {
      if (image === base.rootOrImageDigest) throw new Error("Refusing to remove shared base image");
      const cleanup = Bun.spawn(["docker", "image", "rm", image], { stdout: "pipe", stderr: "pipe" });
      const [code, stdout, stderr] = await Promise.all([cleanup.exited,
        new Response(cleanup.stdout).text(), new Response(cleanup.stderr).text()]);
      expect(code, stderr).toBe(0);
      console.info("INSTALLED_BUILD_IMAGE_REMOVED", { image, stdout });
    }
  });
  const owned = resources.use(await nativeInstallation({ workerEnvironment: base }));
  if (!owned.apiPort || owned.prior.data.dialect !== "sqlite") throw new Error("Expected installed native API");
  const dataRoot = owned.prior.data.dataRoot;
  let operationId: string | null = null;
  const terminal = Promise.withResolvers<{
    status: string; error_code: string | null; result_json: string | null;
  }>();
  void terminal.promise.catch(() => undefined);
  function check() {
    if (!operationId) return;
    const database = new Database(join(dataRoot, "quire.sqlite"), { readonly: true });
    try {
      const row = z.object({ status: z.string(), error_code: z.string().nullable(), result_json: z.string().nullable() })
        .parse(database.query("SELECT status,error_code,result_json FROM operations WHERE id=?").get(operationId));
      if (!["queued", "running"].includes(row.status)) terminal.resolve(row);
    } catch (error) { terminal.reject(error); }
    finally { database.close(); }
  }
  const observer = watch(dataRoot, (_event, file) => { if (file?.startsWith("quire.sqlite")) check(); });
  const timeout = setTimeout(() => terminal.reject(new Error("Installed environment build did not finish")), 240000);
  try {
    await owned.start();
    const login = await fetch(`http://127.0.0.1:${owned.apiPort}/api/auth/login`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email: "operator@quire.local", password }), signal: AbortSignal.timeout(10000),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Missing actual operator session");
    const me = await fetch(`http://127.0.0.1:${owned.apiPort}/api/me`, { headers: { cookie, origin }, signal: AbortSignal.timeout(10000) });
    const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
    const accepted = await fetch(`http://127.0.0.1:${owned.apiPort}/api/admin/environments/build`, {
      method: "POST", headers: { cookie, origin, "content-type": "application/json",
        "x-csrf-token": csrf, "idempotency-key": "installed-environment-build" },
      body: JSON.stringify({ baseId: base.id, packageList: [], fontUploads: [], mirror: "https://archive.ubuntu.com/ubuntu/" }),
      signal: AbortSignal.timeout(15000),
    });
    const acceptedBody: unknown = await accepted.json();
    expect(accepted.status, JSON.stringify(acceptedBody)).toBe(202);
    operationId = z.object({ data: OperationSchema }).parse(acceptedBody).data.id;
    check();
    const completed = await terminal.promise;
    console.info("INSTALLED_BUILD_RESULT", { operationId, ...completed });
    expect(completed.status, JSON.stringify(completed)).toBe("succeeded");
    const result = z.object({ environmentId: IdSchema, image: z.string(), available: z.boolean() })
      .parse(JSON.parse(completed.result_json ?? "null"));
    expect(result.available).toBe(true);
    expect(result.image).not.toBe(base.rootOrImageDigest);
    const database = new Database(join(dataRoot, "quire.sqlite"), { readonly: true });
    try {
      const row = z.object({ manifest_json: z.string(), available: z.number() }).parse(
        database.query("SELECT manifest_json,available FROM environments WHERE id=?").get(result.environmentId));
      expect(row.available).toBe(1);
      expect(EnvironmentSchema.parse(JSON.parse(row.manifest_json)).rootOrImageDigest).toBe(result.image);
    } finally { database.close(); }
  } finally {
    observer.close(); clearTimeout(timeout);
    const ledger = new Database(join(owned.roots.control, "control.sqlite"), { readonly: true });
    try {
      if (ledger.query("SELECT name FROM sqlite_master WHERE name='execution_launches'").get()) {
        const rows = z.array(z.object({ record_json: z.string() })).parse(ledger.query("SELECT record_json FROM execution_launches").all());
        const launches = rows.map(row => ExecutionLaunchSchema.parse(JSON.parse(row.record_json)));
        for (const launch of launches) {
          if (launch.request.work.kind === "environment-build" && launch.result?.image) images.add(launch.result.image);
        }
        console.info("INSTALLED_BUILD_EXECUTIONS", JSON.stringify(launches));
      }
    } finally { ledger.close(); }
  }
}, 360000);
