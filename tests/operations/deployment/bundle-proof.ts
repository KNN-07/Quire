import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, copyFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createBundle, verifyBundle, loadBundle } from "../../../scripts/ops/airgap";
import { install } from "../../../scripts/ops/install";
import { checked } from "../../../deploy/runtime/artifacts";
import { startProductionServer } from "../../../deploy/runtime/server";
import { z } from "zod";
import { EnvironmentSchema } from "@quire/contracts";

if (import.meta.main) {
  const applicationImage = z.string().min(1).parse(process.argv[2] ?? "quire-p2o-deployment-app:bun144-final");
  const environments = z.array(EnvironmentSchema).min(1).parse(
    await Bun.file("docs/evidence/p2o-environments/worker-environments.json").json());
  const producer = EnvironmentSchema.parse(environments[0]);
  if (environments.some(environment => !environment.available ||
      environment.rootOrImageDigest !== producer.rootOrImageDigest)) {
    throw new Error("Final executed profiles must share the selected immutable image");
  }
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-deployment-offline-"));
  const fixtures = [
    ["postgres:17-alpine", "quire-p2o-deployment-postgres:fixture"],
    ["redis:7.4-alpine", "quire-p2o-deployment-redis:fixture"],
    ["minio/minio:RELEASE.2025-09-07T16-13-09Z", "quire-p2o-deployment-s3:fixture"],
    [producer.rootOrImageDigest, "quire-p2o-deployment-toolchain:fixture"],
  ] as const;
  const created: string[] = [];
  try {
    for (const [source, target] of fixtures) {
      await checked(["docker", "image", "tag", source, target]);
      created.push(target);
    }
    const keys = generateKeyPairSync("ed25519");
    const privateKey = join(root, "signing.pem");
    const publicKey = join(root, "trusted.pem");
    await writeFile(privateKey, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    await writeFile(publicKey, keys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    const output = join(root, "bundle");
    const result = await createBundle({
      source: resolve("."), output, bun: process.execPath, signingKey: privateKey,
      images: [applicationImage, ...fixtures.map(([, target]) => target)],
      environments,
    });
    await verifyBundle(output, publicKey);
    await loadBundle(output, publicKey);
    const prefix = await install({
      source: join(output, "payload/release"), prefix: join(root, "installed"),
      bun: join(output, "payload/runtime/bun"), port: 43185,
    });
    console.info("offline.runtime", await checked([join(prefix, "bin/bun"), "--version"]));
    // No package resolver or network downloader is invoked during installation.
    console.info("offline.migrate", await checked([join(prefix, "bin/quire"), "migrate"]));
    const env = (await Bun.file(join(prefix, "quire.env")).text()).trim().split("\n");
    for (const entry of env) {
      const index = entry.indexOf("=");
      process.env[entry.slice(0, index)] = entry.slice(index + 1);
    }
    process.env["QUIRE_DATA_DIR"] = join(prefix, "data");
    process.env["QUIRE_WEB_ROOT"] = join(prefix, "release/dist/web");
    process.env["QUIRE_BACKUP_SIGNING_KEY_FILE"] = join(prefix, "backup-signing.pem");
    const app = await startProductionServer();
    try {
      const input: unknown = JSON.parse(await checked([join(prefix, "bin/quire"), "doctor"]));
      const doctor = z.object({
        bun: z.literal("1.4.4"), environment: z.object({ available: z.literal(true) }),
        health: z.object({ data: z.object({ status: z.literal("ok"), database: z.literal("sqlite") }) }),
      }).parse(input);
      console.info("offline.doctor", JSON.stringify(doctor));
    } finally { await app.close(); }
    for (const name of ["manifest.json", "manifest.sig"]) {
      await copyFile(join(output, name), resolve(`docs/evidence/p2o-deployment/bundle-${Bun.version}-${name}`));
    }
    await copyFile(publicKey, resolve(`docs/evidence/p2o-deployment/bundle-${Bun.version}-trusted-public.pem`));
    console.info(JSON.stringify({
      files: result.files.length, architecture: result.architecture, images: result.images,
      environmentIds: environments.map(environment => environment.id),
      bytes: result.files.reduce((total, file) => total + (file.kind === "file" ? file.bytes : 0), 0),
      temporaryRoot: root, cleanup: "all private keys, archive, copied packages and installation removed in finally",
    }, null, 2));
  } finally {
    try {
      for (const target of created) await checked(["docker", "image", "rm", target]);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
}
