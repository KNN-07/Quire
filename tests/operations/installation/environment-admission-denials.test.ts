import { expect, test } from "bun:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ExecutionLaunchSchema, ExecutionProfileSchema } from "../../../services/operations/installation/execution-model";
import { canonicalJson, controlDigest } from "../../../services/operations/installation/protocol";
import { describeExecutionSource } from "../../../services/operations/installation/execution-source";
import { executionFixture, id, limits } from "./supervisor-execution/fixture";

test("actual authenticated execution broker denies unbuilt images, a different role's exact image and absent profiles", async () => {
  await using fixture = await executionFixture();
  const metadataPath = join(fixture.prior.release.target, "installation-roles.json");
  const inventoryPath = join(fixture.prior.release.target, "installation-runtime.json");
  const metadata = z.object({ installationId: z.string(), roles: z.array(z.unknown()),
    executionProfiles: z.array(ExecutionProfileSchema) }).parse(JSON.parse(await readFile(metadataPath, "utf8")));
  const docker = metadata.executionProfiles.find(profile => profile.id === "docker");
  if (!docker) throw new Error("Missing fixture Docker profile");
  // Provision this fixture's reviewed baseline before starting its authority.
  const next = canonicalJson({ ...metadata, executionProfiles: [
    ...metadata.executionProfiles.filter(profile => profile.id !== "docker"),
    { ...docker, id: "worker-only-image", roles: ["compiler-worker"] },
  ] });
  const inventory = z.object({ migrations: z.array(z.unknown()),
    assets: z.array(z.object({ path: z.string(), digest: z.string() })) })
    .parse(JSON.parse(await readFile(inventoryPath, "utf8")));
  for (const [path, bytes] of [[metadataPath, next], [inventoryPath, canonicalJson({ ...inventory,
    assets: inventory.assets.map(asset => asset.path === "installation-roles.json"
      ? { ...asset, digest: controlDigest(next) } : asset),
  })]] as const) {
    await chmod(path, 0o600); await writeFile(path, bytes); await chmod(path, 0o400);
  }
  const controller = await fixture.start();
  if (fixture.prior.data.dialect !== "sqlite") throw new Error("Expected native fixture");
  const path = join(fixture.prior.data.dataRoot, "work/admission-denial");
  await mkdir(path, { mode: 0o700 });
  const source = await describeExecutionSource(path, limits.workspaceBytes);
  const results = [];
  for (const [profileId, code] of [
    [`sha256:${"f".repeat(64)}`, "CONTROL_EXECUTION_PROFILE_REQUIRED"],
    [fixture.image, "CONTROL_EXECUTION_POLICY_DENIED"],
    ["docker", "CONTROL_EXECUTION_PROFILE_REQUIRED"],
  ]) {
    const result = await fixture.role().channel.request("start", {
      requestId: id(), profileId, work: { kind: "environment-metadata", source }, limits,
    }).then(() => null, (error: unknown) => error);
    expect(result).toMatchObject({ code });
    results.push({ profileId, code });
  }
  const records = z.object({ launches: z.array(ExecutionLaunchSchema) }).parse(await controller.request("records", {}));
  expect(records.launches).toEqual([]);
  console.info("P27_BROKER_DENIALS", { installationId: fixture.config.installationId, root: fixture.root, results, launches: 0 });
}, 180000);
