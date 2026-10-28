import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import ky from "ky";
import { ProjectSchema, FileEntrySchema, EnvironmentSchema, assertNever } from "@quire/contracts";
import { checked } from "../../../deploy/runtime/artifacts";
import { probeEnvironment } from "../../../services/compiler/environment";

const stateSchema = z.object({
  projectId: z.uuid(), fileId: z.uuid(), source: z.string(), cookie: z.string(),
});
const platform = z.enum(["compose", "cluster"]).parse(process.argv[2]);
const action = z.enum(["create", "check"]).parse(process.argv[3]);
const base = { compose: "http://127.0.0.1:43182", cluster: "http://127.0.0.1:43184" }[platform];
const receipt = `/tmp/quire-p2o-deployment-compose/${platform}-proof.json`;
async function sql(statement: string): Promise<string> {
  const command = {
    compose: ["docker", "exec", "quire-p2o-deployment-postgres-1"],
    cluster: ["kubectl", "-n", "quire-p2o-deployment", "exec", "postgres-0", "--"],
  }[platform];
  return checked([...command, "psql", "-U", "quire", "-d", "quire", "-v", "ON_ERROR_STOP=1", "-At", "-c", statement]);
}
const http = ky.create({ prefixUrl: base, retry: 0, timeout: 20_000 });
switch (action) {
case "create": {
  const email = `deployment-${crypto.randomUUID()}@example.invalid`;
  const password = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex");
  await http.post("api/auth/register", {
    headers: { origin: base, "idempotency-key": crypto.randomUUID() },
    json: { name: "Owned deployment smoke", email, password },
  });
  // Test fixture enrollment, not a bypass in the production registration flow.
  await sql(`INSERT INTO verified_emails(id,user_id,email,verified_at)
    SELECT '${crypto.randomUUID()}',id,primary_email,'${new Date().toISOString()}'
    FROM users WHERE primary_email='${email}'`);
  const environment = EnvironmentSchema.parse({ ...await probeEnvironment(AbortSignal.timeout(180_000)), available: false });
  // Source-only projects may retain an unavailable pin. No API-local compiler
  // or remote image availability is asserted by this persistence scenario.
  const manifest = JSON.stringify(environment).replaceAll("'", "''");
  await sql(`INSERT INTO environments(id,label,release,backend,manifest_json,available,probe_at,created_at)
    VALUES('${environment.id}','${environment.label}','${environment.release}','bwrap','${manifest}',0,
    '${environment.probeAt}','${new Date().toISOString()}') ON CONFLICT DO NOTHING`);
  const login = await http.post("api/auth/login", {
    headers: { origin: base }, json: { email, password },
  });
  const cookie = z.string().min(1).parse(login.headers.get("set-cookie")?.split(";")[0]);
  const me = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(
    await http.get("api/me", { headers: { cookie } }).json());
  const headers = { cookie, origin: base, "x-csrf-token": me.data.csrfToken, "idempotency-key": crypto.randomUUID() };
  const project = z.object({ data: ProjectSchema }).parse(await http.post("api/projects", {
    headers, json: { name: "Owned deployed durable source", origin: { kind: "example" } },
  }).json()).data;
  const files = z.object({ data: z.array(FileEntrySchema) }).parse(
    await http.get(`api/projects/${project.id}/files?branch=main`, { headers: { cookie } }).json()).data;
  const main = files.find(file => file.path === "main.tex");
  if (!main) throw new Error("Created project has no main file");
  const source = await http.get(`api/projects/${project.id}/files/${main.id}/content?branch=main`, { headers: { cookie } }).text();
  await writeFile(receipt, JSON.stringify({ projectId: project.id, fileId: main.id, source, cookie }), {
    flag: "wx", mode: 0o600,
  });
  console.info(JSON.stringify({ platform, projectId: project.id, mainFileId: main.id, bytes: Buffer.byteLength(source),
    sourceDigest: new Bun.CryptoHasher("sha256").update(source).digest("hex"), compilationAvailable: false }));
  break;
}
case "check": {
  const input: unknown = JSON.parse(await readFile(receipt, "utf8"));
  const state = stateSchema.parse(input);
  const headers = { cookie: state.cookie };
  const source = await http.get(`api/projects/${state.projectId}/files/${state.fileId}/content?branch=main`, { headers }).text();
  if (source !== state.source) throw new Error("Durable source bytes changed across restart");
  const project = z.object({ data: ProjectSchema }).parse(
    await http.get(`api/projects/${state.projectId}?branch=main`, { headers }).json()).data;
  if (project.name !== "Owned deployed durable source") throw new Error("Durable project metadata changed");
  const rows = await sql(`SELECT COUNT(*) FROM files WHERE blob IS NOT NULL; SELECT tree FROM snapshots WHERE project_id='${state.projectId}' ORDER BY created_at LIMIT 1`);
  if (!/\nsha1:[a-f0-9]{40}$/.test(rows)) throw new Error(`Missing durable SQL checkpoint tree: ${rows}`);
  const repository = {
    compose: ["docker", "exec", "quire-p2o-deployment-repository-1"],
    cluster: ["kubectl", "-n", "quire-p2o-deployment", "exec", "quire-p2o-deployment-repository-0", "--"],
  }[platform];
  const head = z.string().regex(/^[a-f0-9]{40}$/).parse(await checked([...repository,
    "git", "--git-dir", `/git/${state.projectId}.git`, "for-each-ref", "--format=%(objectname)", "refs/quire/history"]));
  const tree = await checked([...repository, "git", "--git-dir", `/git/${state.projectId}.git`, "rev-parse", `${head}^{tree}`]);
  if (!rows.endsWith(`sha1:${tree}`)) throw new Error("Canonical repository tree differs from durable SQL checkpoint");
  console.info(JSON.stringify({ platform, projectId: state.projectId, sourceBytes: Buffer.byteLength(source), durableSqlTree: rows, repositoryCommit: head, repositoryTree: tree }));
  break;
}
default: assertNever(action);
}
