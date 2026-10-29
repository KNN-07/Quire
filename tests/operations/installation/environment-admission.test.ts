import { expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { EnvironmentSchema } from "@quire/contracts";
import { InstallationRolesSchema } from "../../../services/operations/installation/binding";
import { signedEnvironmentAdmission } from "../../../services/operations/installation/environment-admission";
import { defaultLimits } from "../../../workers/compiler/sandbox";
import { canonicalJson, controlDigest } from "../../../services/operations/installation/protocol";
import { signAdmissionRelease } from "../../../scripts/ops/environment-admission-release";

const environment = EnvironmentSchema.parse({
  id: "00000000-0000-4000-8000-000000000030", label: "Custom", release: "2026", backend: "docker",
  rootOrImageDigest: `sha256:${"a".repeat(64)}`, packagesDigest: "b".repeat(64),
  engines: ["pdflatex"], helpers: ["bibtex", "biber", "synctex"],
  available: true, experimental: true, probeAt: "2026-10-28T00:00:00.000Z",
});
const manifest = InstallationRolesSchema.parse({
  installationId: "admission-test", controlSocket: "/owned/control.sock",
  roles: ["controller", "worker"].map(role => ({ role,
    kind: role === "controller" ? "worker-controller" : "worker", compilerBackend: "docker",
    port: 3001, publicUrl: "http://localhost:5173", coordinator: "http://localhost:3001",
    environmentIds: [environment.id] })),
  executionProfiles: [
    { id: "pool", backend: "worker", roles: ["controller"], workerRole: "worker", kinds: ["worker"],
      limits: defaultLimits, maxConcurrent: 1 },
    { id: "custom", backend: "docker", roles: ["worker"], image: environment.rootOrImageDigest,
      kinds: ["compile", "pdf-validate", "environment-metadata", "environment-confinement", "environment-fixture"],
      limits: defaultLimits, maxConcurrent: 2 },
  ],
});

test("signed worker route requires exact environment, image, roles, probe recipes and limits", () => {
  expect(signedEnvironmentAdmission(manifest, environment)).toEqual({
    controllerRole: "controller", workerRole: "worker", profileIds: ["custom"],
  });
  expect(signedEnvironmentAdmission(manifest, { ...environment, rootOrImageDigest: `sha256:${"c".repeat(64)}` })).toBeNull();
  expect(signedEnvironmentAdmission({ ...manifest, roles: manifest.roles.map(role =>
    role.role === "worker" ? { ...role, environmentIds: [] } : role) }, environment)).toBeNull();
  for (const changed of [
    { roles: ["api"] }, { kinds: ["compile"] as const }, { limits: { ...defaultLimits, processes: 127 } },
  ]) expect(signedEnvironmentAdmission({ ...manifest, executionProfiles: manifest.executionProfiles?.map(profile =>
    profile.id === "custom" ? { ...profile, ...changed } : profile) }, environment)).toBeNull();
});

test("revoked and ambiguous signed profiles cannot claim admission", () => {
  const profiles = manifest.executionProfiles ?? [];
  expect(signedEnvironmentAdmission({ ...manifest, executionProfiles: profiles.filter(profile => profile.id !== "custom") }, environment)).toBeNull();
  const custom = profiles.find(profile => profile.id === "custom");
  if (!custom) throw new Error("Missing profile");
  expect(signedEnvironmentAdmission({ ...manifest, executionProfiles: [...profiles, { ...custom, id: "duplicate" }] }, environment)).toBeNull();
  expect(signedEnvironmentAdmission({ ...manifest, executionProfiles: [...profiles,
    { ...custom, id: "limited-duplicate", limits: { ...defaultLimits, processes: 1 } }] }, environment)).toBeNull();
  expect(signedEnvironmentAdmission({ ...manifest, executionProfiles: [...profiles,
    { ...custom, image: `sha256:${"c".repeat(64)}` }] }, environment)).toBeNull();
});

test("existing signed local API execution does not imply managed worker admission", () => {
  const local = InstallationRolesSchema.parse({ ...manifest, roles: [{ role: "api", kind: "api",
    compilerBackend: "docker", port: 3001, publicUrl: "http://localhost:5173" }],
    executionProfiles: [{ id: "api-image", backend: "docker", roles: ["api"], image: environment.rootOrImageDigest,
      kinds: ["compile", "pdf-validate"], limits: defaultLimits, maxConcurrent: 2 }] });
  expect(signedEnvironmentAdmission(local, environment, "api")).toEqual({
    controllerRole: "api", workerRole: "api", profileIds: ["api-image"],
  });
  expect(signedEnvironmentAdmission(local, environment)).toBeNull();
  expect(signedEnvironmentAdmission(local, { ...environment, rootOrImageDigest: `sha256:${"f".repeat(64)}` }, "api")).toBeNull();
});

test("operator packager signs exact manifest and package bytes without changing other assets", () => {
  const key = generateKeyPairSync("ed25519");
  const role = "export const prepareInstallationRole = () => {};";
  const metadata = canonicalJson(manifest);
  const inventory = { migrations: [{ id: "test", sql: "SELECT 1" }], assets: [
    { path: "bin/role.js", digest: controlDigest(role) },
    { path: "installation-roles.json", digest: controlDigest(metadata) },
  ] };
  const pack = { format: 1 as const, entrypoint: "bin/role.js", files: [
    { path: "bin/role.js", executable: true, data: Buffer.from(role).toString("base64") },
    { path: "installation-roles.json", executable: false, data: Buffer.from(metadata).toString("base64") },
    { path: "installation-runtime.json", executable: false, data: Buffer.from(canonicalJson(inventory)).toString("base64") },
  ] };
  const release = { id: environment.id, version: "2.0.0", sequence: 2, security: false, notes: "Admission",
    expiresAt: "2027-01-01T00:00:00.000Z", compatibleSchema: [1], packageUrl: "https://updates.example.test/package" };
  const signed = signAdmissionRelease({ package: pack, manifest, release }, key.privateKey);
  expect(signed.release.packageDigest).toBe(controlDigest(signed.packageBytes));
  expect(signed.release.packageBytes).toBe(signed.packageBytes.length);
  expect(verify(null, Buffer.from(signed.feed.payload, "base64"), key.publicKey,
    Buffer.from(signed.feed.signature, "base64"))).toBe(true);
  expect(() => signAdmissionRelease({ package: { ...pack, files: pack.files.map(file =>
    file.path === "bin/role.js" ? { ...file, data: Buffer.from("tampered").toString("base64") } : file) },
    manifest, release }, key.privateKey)).toThrow("ADMISSION_PACKAGE_ASSET_CHANGED");
  expect(() => signAdmissionRelease({ package: pack, manifest: { ...manifest, installationId: "other" }, release },
    key.privateKey)).toThrow("ADMISSION_INSTALLATION_MISMATCH");
});
