import { expect, mock, test } from "bun:test";
import { ExecutionProfileSchema } from "../../../services/operations/installation/execution-model";
const image = `sha256:${"a".repeat(64)}`;
const profile = ExecutionProfileSchema.parse({ id: "pandoc", roles: ["api"], kinds: ["pandoc-probe", "document-convert"],
  backend: "docker", image, maxConcurrent: 1,
  limits: { wallSeconds: 60, memoryBytes: 536870912, processes: 64, workspaceBytes: 67108864 } });
let profiles = [profile];
await mock.module("../../../services/operations/installation/launch", () => ({
  installationRoleSession: () => ({ permit: { binding: {}, execution: { role: "api", installationId: "fixture" } } }),
}));
await mock.module("../../../services/operations/installation/binding", () => ({
  loadInstallationRole: () => Promise.resolve({ manifest: { installationId: "fixture", executionProfiles: profiles } }),
}));
const { installationExecutionContext } = await import("../../../services/operations/installation/caller-execution-context");
const input = { kind: "document-convert", backend: "docker", image, profile: "default", limits: profile.limits } as const;
test("conversion selects only one current role's signed immutable Docker profile", async () => {
  expect((await installationExecutionContext(input))?.profileId).toBe("pandoc");
  for (const grants of [[], [{ ...profile, roles: ["other"] }], [{ ...profile, backend: "bwrap" as const }],
    [profile, { ...profile, id: "duplicate" }]]) {
    profiles = grants;
    expect(await installationExecutionContext(input).then(() => null, (error: unknown) => error))
      .toMatchObject({ code: "UPDATES_EXECUTION_PROFILE_UNAVAILABLE" });
  }
});
test("conversion cannot inherit a different image or exceed its signed resource grant", async () => {
  profiles = [profile];
  expect(await installationExecutionContext({ ...input, image: `sha256:${"b".repeat(64)}` })
    .then(() => null, (error: unknown) => error)).toMatchObject({ code: "UPDATES_EXECUTION_PROFILE_UNAVAILABLE" });
  expect(await installationExecutionContext({ ...input, limits: { ...profile.limits, wallSeconds: 61 } })
    .then(() => null, (error: unknown) => error)).toMatchObject({ code: "CONTROL_EXECUTION_LIMITS" });
});
