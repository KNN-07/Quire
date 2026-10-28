import { writeFile } from "node:fs/promises";
import ky from "ky";
import { z } from "zod";
import { BackupSchema, OperationSchema } from "@quire/contracts";
import { checked } from "../../../deploy/runtime/artifacts";

if (import.meta.main) {
  const platform = z.enum(["compose", "cluster"]).parse(process.argv[2]);
  const endpoints = {
    compose: { a: "http://127.0.0.1:43182", b: "http://127.0.0.1:43183", origin: "http://127.0.0.1:43182" },
    cluster: { a: "http://127.0.0.1:43186", b: "http://127.0.0.1:43184", origin: "http://127.0.0.1:43184" },
  }[platform];
  const sql = (statement: string) => checked([
    ...{
      compose: ["docker", "exec", "quire-p2o-deployment-postgres-1"],
      cluster: ["kubectl", "-n", "quire-p2o-deployment", "exec", "postgres-0", "--"],
    }[platform], "psql", "-U", "quire", "-d", "quire", "-v", "ON_ERROR_STOP=1", "-At", "-c", statement,
  ]);
  const http = ky.create({ retry: 0, timeout: 180_000, headers: { origin: endpoints.origin },
    hooks: { afterResponse: [async (_request, _options, response) => {
      if (!response.ok) throw new Error(`Backup HTTP ${response.status}: ${await response.clone().text()}`);
    }] },
  });
  const email = `shared-backup-${crypto.randomUUID()}@example.invalid`;
  const password = crypto.randomUUID();
  await http.post(`${endpoints.a}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() }, json: { name: "Shared backup fixture", email, password },
  });
  // Disposable fixture enrollment; the production operator route is unchanged.
  await sql(`UPDATE users SET operator=1 WHERE primary_email='${email}';
    INSERT INTO verified_emails(id,user_id,email,verified_at)
    SELECT '${crypto.randomUUID()}',id,primary_email,'${new Date().toISOString()}' FROM users WHERE primary_email='${email}'`);
  const login = await http.post(`${endpoints.a}/api/auth/login`, { json: { email, password } });
  const cookie = z.string().min(1).parse(login.headers.get("set-cookie")?.split(";")[0]);
  const me = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(
    await http.get(`${endpoints.a}/api/me`, { headers: { cookie } }).json());
  await writeFile(`/tmp/quire-p2o-deployment-compose/${platform}-backup-proof.json`,
    JSON.stringify({ cookie, csrf: me.data.csrfToken }), { mode: 0o600 });
  const headers = { cookie, "x-csrf-token": me.data.csrfToken, "idempotency-key": crypto.randomUUID() };
  const backup = z.object({ data: BackupSchema }).parse(
    await http.post(`${endpoints.a}/api/admin/backups`, { headers, json: {} }).json()).data;
  if (backup.status !== "succeeded" || backup.destination !== `/backups/${backup.id}`) {
    throw new Error(`Backup is not on the shared filesystem: ${JSON.stringify(backup)}`);
  }
  switch (platform) {
    case "compose": {
      const compose = ["docker", "compose", "--env-file", "/tmp/quire-p2o-deployment-compose/compose.env",
        "-f", "deploy/compose/compose.yaml"];
      await checked([...compose, "stop", "api-a"]);
      await checked([...compose, "rm", "-f", "api-a"]);
      await checked(["docker", "volume", "rm", "quire-p2o-deployment_api-a-private"]);
      break;
    }
    case "cluster":
      await checked(["kubectl", "-n", "quire-p2o-deployment", "scale", "statefulset",
        "quire-p2o-deployment-api", "--replicas=1"]);
      await checked(["kubectl", "-n", "quire-p2o-deployment", "wait", "--for=delete",
        "pod/quire-p2o-deployment-api-1", "--timeout=120s"]);
      await checked(["kubectl", "-n", "quire-p2o-deployment", "delete", "pvc",
        "private-quire-p2o-deployment-api-1", "--wait=true", "--timeout=120s"]);
      break;
  }
  const verified = z.object({ data: OperationSchema }).parse(await http.post(
    `${endpoints.b}/api/admin/backups/${backup.id}/verify`, {
      headers: { ...headers, "idempotency-key": crypto.randomUUID() }, json: { expectedVersion: 0 },
    }).json()).data;
  if (verified.status !== "succeeded" || verified.result?.["manifestDigest"] !== backup.manifestDigest) {
    throw new Error(`Surviving API could not verify the exact archive: ${JSON.stringify(verified)}`);
  }
  const listed = z.object({ data: z.object({ items: z.array(BackupSchema) }) }).parse(
    await http.get(`${endpoints.b}/api/admin/backups?limit=100`, { headers: { cookie } }).json()).data;
  const retained = listed.items.find(item => item.id === backup.id);
  if (!retained?.verifiedAt || retained.manifestDigest !== backup.manifestDigest) {
    throw new Error("Surviving API lost the verified shared backup");
  }
  console.info(JSON.stringify({ platform, backupId: backup.id, destination: backup.destination,
    manifestDigest: backup.manifestDigest, creatorPrivateDataRemoved: true,
    survivingApiVerifiedAndListed: true, sharedRoot: "/backups" }));
}
