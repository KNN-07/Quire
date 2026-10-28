import { readFile, writeFile } from "node:fs/promises";
import { checked } from "../../../deploy/runtime/artifacts";

if (import.meta.main) {
  const directory = "/tmp/quire-p2o-deployment-compose";
  const vars = Object.fromEntries((await readFile(`${directory}/compose.env`, "utf8")).trim()
    .split("\n").map(line => line.split("=", 2)));
  const original = (await readFile(`${directory}/runtime.env`, "utf8")).split("\n")
    .filter(line => !line.startsWith("QUIRE_PUBLIC_URL=")).join("\n");
  const password = vars["QUIRE_DB_PASSWORD"];
  const access = vars["QUIRE_S3_ACCESS_KEY_ID"];
  const secret = vars["QUIRE_S3_SECRET_ACCESS_KEY"];
  if (!password || !access || !secret) throw new Error("Missing owned fixture credentials");
  await writeFile(`${directory}/cluster.env`, `${original}
QUIRE_POSTGRES_URL=postgres://quire:${password}@postgres:5432/quire
QUIRE_REDIS_URL=redis://redis:6379
QUIRE_REDIS_NAMESPACE=quire-p2o-deployment
QUIRE_S3_ENDPOINT=http://s3:9000
QUIRE_S3_BUCKET=quire
QUIRE_S3_REGION=us-east-1
QUIRE_S3_ACCESS_KEY_ID=${access}
QUIRE_S3_SECRET_ACCESS_KEY=${secret}
POSTGRES_USER=quire
POSTGRES_DB=quire
POSTGRES_PASSWORD=${password}
MINIO_ROOT_USER=${access}
MINIO_ROOT_PASSWORD=${secret}
`, { mode: 0o600, flag: "wx" });
  console.info(await checked(["kubectl", "create", "namespace", "quire-p2o-deployment"]));
  console.info(await checked(["kubectl", "-n", "quire-p2o-deployment", "create", "secret", "generic",
    "quire-p2o-deployment", `--from-env-file=${directory}/cluster.env`]));
  console.info(await checked(["kubectl", "-n", "quire-p2o-deployment", "create", "secret", "generic",
    "quire-p2o-deployment-tls", `--from-file=ca.pem=${directory}/tls/ca.pem`,
    `--from-file=cert.pem=${directory}/tls/cert.pem`, `--from-file=key.pem=${directory}/tls/key.pem`]));
  console.info(await checked(["kubectl", "-n", "quire-p2o-deployment", "create", "secret", "generic",
    "quire-p2o-deployment-backup-signer", `--from-file=key.pem=${directory}/backup-signing.pem`]));
  console.info(await checked(["kubectl", "-n", "quire-p2o-deployment", "apply", "-f",
    "tests/operations/deployment/cluster-stores.yaml"]));
}
