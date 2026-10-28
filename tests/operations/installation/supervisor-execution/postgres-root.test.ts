import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { IdSchema } from "@quire/contracts";
import { foundationMigrations } from "@quire/runtime";
import { restoreTargetScaleFixture } from "../../backups/restore-target-scale-fixture";
import { backupModules } from "../../backups/fixture";
import { inspectRestoreTarget } from "../../../../services/operations/backups/restore-target";
import { BindingSchema } from "../../../../services/operations/installation/model";
import { canonicalJson, controlDigest } from "../../../../services/operations/installation/protocol";
import { assertFreshRuntimeRoot, resolveInstallationRoleMounts } from "../../../../services/operations/installation/role-mounts";
import { command, inspectUnit, cgroupPids } from "../../../../services/operations/installation/systemd-process";
import { executionFixture } from "./fixture";

test("real PostgreSQL generation runtime root is writable outside Git while control state and role secrets remain protected", async () => {
  await using fixture = await executionFixture();
  await using scale = await restoreTargetScaleFixture(crypto.getRandomValues(new Uint8Array(32)));
  const source = await scale.open("source");
  const identity = await inspectRestoreTarget(source.runtime);
  if (identity.database.kind !== "postgres") throw new Error("Actual PostgreSQL identity required");
  const runtimeRoot = source.runtime.config.dataDir;
  for (const directory of ["cache", "backups", "restores"]) await mkdir(join(runtimeRoot, directory), { mode: 0o700 });
  const postgresSecret = join(fixture.roots.control, "secrets/postgres.key");
  await writeFile(postgresSecret, source.configuration.QUIRE_POSTGRES_URL, { mode: 0o600 });
  const files = {
    "redis.key": source.configuration.QUIRE_REDIS_URL,
    "repository.key": source.configuration.QUIRE_REPOSITORY_TOKEN,
    "s3.key": canonicalJson({ accessKeyId: source.configuration.QUIRE_S3_ACCESS_KEY_ID,
      secretAccessKey: source.configuration.QUIRE_S3_SECRET_ACCESS_KEY }),
  };
  for (const [name, value] of Object.entries(files)) await writeFile(join(runtimeRoot, name), value, { mode: 0o600 });
  const releaseRoot = join(fixture.roots.app, "releases/postgres-probe");
  await mkdir(releaseRoot, { mode: 0o700 });
  const roleMetadata = canonicalJson({ roles: [{ role: "api-a", kind: "api" }, { role: "repository", kind: "repository" }] });
  const script = `
import { SQL } from "bun";
import { readFile, writeFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
const [root, secret, control, git] = process.argv.slice(2);
const sql = new SQL((await readFile(secret, "utf8")).trim());
try { const rows = await sql.unsafe("SELECT current_database() AS name"); assert.equal(rows[0].name, "restore_source"); }
finally { await sql.close(); }
for (const name of ["work", "mail", "cache", "backups", "restores"]) await writeFile(root + "/" + name + "/owned-probe", "generation-runtime");
await assert.rejects(readFile(control));
await assert.rejects(writeFile(secret, "must-not-change"));
await assert.rejects(writeFile(git + "/must-not-exist", "must-not-write"));
console.log("PG_ROOT_PROBE_OK");
`;
  await writeFile(join(releaseRoot, "main.js"), script, { mode: 0o400 });
  await writeFile(join(releaseRoot, "installation-roles.json"), roleMetadata, { mode: 0o400 });
  await writeFile(join(releaseRoot, "installation-runtime.json"), canonicalJson({
    migrations: [...await foundationMigrations(), ...backupModules.flatMap(module => module.migrations ?? [])],
    assets: [{ path: "main.js", digest: controlDigest(script) },
      { path: "installation-roles.json", digest: controlDigest(roleMetadata) }],
  }), { mode: 0o400 });
  const binding = BindingSchema.parse({ release: { ...fixture.prior.release, target: releaseRoot }, data: {
    dialect: "postgres", generationId: IdSchema.parse(crypto.randomUUID()),
    database: { identity: `${identity.database.cluster}:${identity.database.database}`, connectionSecretRef: postgresSecret },
    blobs: { endpoint: source.configuration.QUIRE_S3_ENDPOINT, region: source.configuration.QUIRE_S3_REGION,
      bucket: source.configuration.QUIRE_S3_BUCKET, credentialsSecretRef: join(runtimeRoot, "s3.key") },
    repository: { volume: identity.repositories.path, endpoint: source.server.url, credentialsSecretRef: join(runtimeRoot, "repository.key") },
    redis: { namespace: "p9-root", connectionSecretRef: join(runtimeRoot, "redis.key") },
    applicationSecretRef: join(runtimeRoot, "secret.key"),
  } });
  const denied = await resolveInstallationRoleMounts(fixture.config, binding, "api-a").then(() => null, (error: unknown) => error);
  expect(denied).toMatchObject({ code: "CONTROL_ROLE_SECRET_REQUIRED" });
  const config = { ...fixture.config, roleSecrets: [{ role: "api-a", files: [postgresSecret] },
    { role: "repository", files: [postgresSecret] }] };
  const mounts = await resolveInstallationRoleMounts(config, binding, "api-a");
  expect(mounts.runtimeRoot).toBe(runtimeRoot);
  expect(mounts.writableRoots).toEqual([runtimeRoot]);
  expect((await resolveInstallationRoleMounts(config, binding, "repository")).writableRoots).toContain(identity.repositories.path);
  if (binding.data.dialect !== "postgres") throw new Error("Scale binding required");
  const aliasedGeneration = { ...binding, data: { ...binding.data, generationId: IdSchema.parse(crypto.randomUUID()) } };
  expect(await assertFreshRuntimeRoot(config, aliasedGeneration, [binding]).then(() => null, (error: unknown) => error))
    .toMatchObject({ code: "CONTROL_RESTORE_RUNTIME_SHARED" });
  const overlapping = { ...binding, data: { ...binding.data,
    applicationSecretRef: join(identity.repositories.path, "secret.key") } };
  expect(await resolveInstallationRoleMounts(config, overlapping, "api-a").then(() => null, (error: unknown) => error))
    .toMatchObject({ code: "CONTROL_ROOT_OVERLAP" });
  const unit = `quire-${fixture.config.installationId}-postgres-root-probe.service`;
  await writeFile(join(fixture.root, "owned-postgres-root-unit.json"), canonicalJson({
    unit, runtimeRoot, gitVolume: identity.repositories.path, controllerRoot: fixture.config.controlRoot,
  }), { mode: 0o600 });
  try {
    const result = await command(config, ["/usr/bin/systemd-run", "--user", "--quiet", "--wait", "--pipe", "--collect", `--unit=${unit}`,
      "--service-type=exec", "--property=KillMode=control-group", "/usr/bin/bwrap",
      "--unshare-pid", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
      "--tmpfs", "/run", "--tmpfs", fixture.config.controlRoot,
      "--ro-bind", dirname(config.launcher.executable), dirname(config.launcher.executable),
      "--ro-bind", releaseRoot, releaseRoot,
      ...mounts.writableRoots.flatMap(path => ["--bind", path, path]),
      ...mounts.readOnlyFiles.flatMap(path => ["--ro-bind", path, path]),
      "--", config.launcher.executable, join(releaseRoot, "main.js"), runtimeRoot, postgresSecret,
      join(config.controlRoot, "control.sqlite"), identity.repositories.path]);
    expect(result).toBe("PG_ROOT_PROBE_OK");
    for (const name of ["work", "mail", "cache", "backups", "restores"]) {
      expect(await readFile(join(runtimeRoot, name, "owned-probe"), "utf8")).toBe("generation-runtime");
    }
    expect(await readFile(postgresSecret, "utf8")).toBe(source.configuration.QUIRE_POSTGRES_URL);
    expect((await inspectRestoreTarget(source.runtime)).repositories.empty).toBe(true);
  } finally {
    const observed = await inspectUnit(config, unit);
    if (!["inactive", "failed"].includes(observed.state)) await command(config, ["/usr/bin/systemctl", "--user", "stop", unit]);
    if (observed.cgroup) expect(await cgroupPids(observed.cgroup)).toEqual([]);
    if (observed.state === "failed") await command(config, ["/usr/bin/systemctl", "--user", "reset-failed", unit]);
    console.info("P9_PG_ROOT_UNIT_CLEANED", unit);
  }
}, 180000);
