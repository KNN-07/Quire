import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { generateKeyPairSync } from "node:crypto";
import { z } from "zod";
import { ArtifactError, checked, copyRelease, freshDirectory } from "../../deploy/runtime/artifacts";

const optionsSchema = z.strictObject({
  source: z.string().min(1), prefix: z.string().min(1), bun: z.string().min(1),
  port: z.coerce.number().int().min(1024).max(65535).default(43181),
});
export type InstallOptions = z.input<typeof optionsSchema>;

/** Installs only into a new caller-owned prefix; no daemon or service is enabled. */
export async function install(input: InstallOptions): Promise<string> {
  const options = optionsSchema.parse(input);
  if (process.platform !== "linux") throw new ArtifactError("LINUX_REQUIRED", process.platform);
  const version = await checked([resolve(options.bun), "--version"]);
  if (version !== "1.4.4") throw new ArtifactError("BUN_VERSION_REQUIRED", version);
  const prefix = await freshDirectory(options.prefix);
  await mkdir(join(prefix, "release"), { mode: 0o700 });
  await copyRelease(options.source, join(prefix, "release"));
  await mkdir(join(prefix, "bin"), { mode: 0o700 });
  await mkdir(join(prefix, "data"), { mode: 0o700 });
  await copyFile(resolve(options.bun), join(prefix, "bin/bun"));
  await chmod(join(prefix, "bin/bun"), 0o755);
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  await writeFile(join(prefix, "backup-signing.pem"),
    generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600, flag: "wx" });
  await writeFile(join(prefix, "quire.env"), [
    "NODE_ENV=production", "QUIRE_PROFILE=local", "QUIRE_HOST=127.0.0.1",
    `QUIRE_PORT=${options.port}`, `QUIRE_PUBLIC_URL=http://127.0.0.1:${options.port}`,
    `QUIRE_SECRET_KEY=${key}`, "",
  ].join("\n"), { mode: 0o600, flag: "wx" });
  await writeFile(join(prefix, "bin/quire"), `#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
set -a
. "$ROOT/quire.env"
set +a
export QUIRE_DATA_DIR="$ROOT/data"
export QUIRE_WEB_ROOT="$ROOT/release/dist/web"
export QUIRE_BACKUP_SIGNING_KEY_FILE="\${QUIRE_BACKUP_SIGNING_KEY_FILE:-$ROOT/backup-signing.pem}"
cd "$ROOT/release"
case "\${1:-serve}" in
  migrate) exec "$ROOT/bin/bun" scripts/migrate.ts ;;
  serve) "$ROOT/bin/bun" scripts/migrate.ts
    exec "$ROOT/bin/bun" deploy/runtime/server.ts ;;
  repository) exec "$ROOT/bin/bun" deploy/runtime/repository.ts ;;
  worker) exec "$ROOT/bin/bun" workers/compiler/main.ts ;;
  doctor) exec "$ROOT/bin/bun" deploy/runtime/doctor.ts ;;
  *) printf '%s\\n' 'Usage: quire {serve|migrate|repository|worker|doctor}' >&2; exit 2 ;;
esac
`, { mode: 0o755, flag: "wx" });
  return prefix;
}

if (import.meta.main) {
  const args = parseArgs({ options: {
    source: { type: "string" }, prefix: { type: "string" },
    bun: { type: "string", default: process.execPath }, port: { type: "string", default: "43181" },
  }, strict: true, allowPositionals: false });
  console.info("install.complete", await install(optionsSchema.parse(args.values)));
}
