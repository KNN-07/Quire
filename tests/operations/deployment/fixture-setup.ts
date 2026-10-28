import { mkdir, writeFile, copyFile, chmod } from "node:fs/promises";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { z } from "zod";
import { checked } from "../../../deploy/runtime/artifacts";

if (import.meta.main) {
  const image = z.string().min(1).parse(process.argv[2]);
  const root = "/tmp/quire-p2o-deployment-compose";
  await mkdir(root, { mode: 0o700 });
  await mkdir(`${root}/tls`, { mode: 0o700 });
  await checked(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-subj", "/CN=repository", "-addext", "subjectAltName=DNS:repository,DNS:quire-p2o-deployment-repository",
    "-keyout", `${root}/tls/key.pem`, "-out", `${root}/tls/cert.pem`, "-days", "1"]);
  await chmod(`${root}/tls/key.pem`, 0o600);
  await copyFile(`${root}/tls/cert.pem`, `${root}/tls/ca.pem`);
  const signer = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  await writeFile(`${root}/backup-signing.pem`, signer, { mode: 0o600, flag: "wx" });
  await writeFile(`${root}/runtime.env`, `QUIRE_SECRET_KEY=${randomBytes(32).toString("hex")}
QUIRE_REPOSITORY_TOKEN=${randomBytes(32).toString("hex")}
QUIRE_PUBLIC_URL=http://127.0.0.1:43182
`, { mode: 0o600, flag: "wx" });
  await writeFile(`${root}/compose.env`, `QUIRE_PROJECT=quire-p2o-deployment
QUIRE_APP_IMAGE=${image}
QUIRE_BUN_IMAGE=oven/bun:1.4.4-debian@sha256:93d5032fe06d163427822dc1598f420363759bb18155c9cc90eb1be05a64a19e
QUIRE_ENV_FILE=${root}/runtime.env
QUIRE_TLS_DIR=${root}/tls
QUIRE_BACKUP_SIGNING_KEY_FILE=${root}/backup-signing.pem
QUIRE_DB_PASSWORD=${randomBytes(24).toString("hex")}
QUIRE_S3_ACCESS_KEY_ID=deployment${randomBytes(8).toString("hex")}
QUIRE_S3_SECRET_ACCESS_KEY=${randomBytes(24).toString("hex")}
QUIRE_HTTP_PORT=43182
QUIRE_HTTP_SECOND_PORT=43183
`, { mode: 0o600, flag: "wx" });
  console.info(JSON.stringify({ root, image, privateModes: "0600", sharedBackupRoot: "/backups" }));
}
