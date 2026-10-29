import { readFile } from "node:fs/promises";
import { z } from "zod";
import { EnvironmentSchema } from "@quire/contracts";
import { InstallationRolesSchema } from "../../services/operations/installation/binding";
import { ExecutionLaunchSchema } from "../../services/operations/installation/execution-model";
import { signedEnvironmentAdmission } from "../../services/operations/installation/environment-admission";
import { canonicalJson, controlDigest } from "../../services/operations/installation/protocol";
import { ProbeReportSchema, profileFor } from "../../services/operations/environments/model";
import { manifestFromProbe } from "../../services/operations/environments/probe";

export const AdmissionProposalSchema = z.strictObject({
  manifest: InstallationRolesSchema,
  environment: EnvironmentSchema,
  report: ProbeReportSchema,
  build: ExecutionLaunchSchema,
  controllerRole: z.string().min(1),
  workerRole: z.string().min(1),
  sourceProfileId: z.string().min(1),
  profileId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(128),
});

/** Offline operator tool. Returns unsigned review material; never changes live authority. */
export function proposeEnvironmentAdmission(input: z.input<typeof AdmissionProposalSchema>) {
  const value = AdmissionProposalSchema.parse(input);
  const { manifest, environment, report, build } = value;
  if (environment.backend !== "docker" || !environment.available || !report.available ||
      !report.checks.length || report.checks.some(check => check.code !== 0) ||
      canonicalJson(environment) !== canonicalJson(manifestFromProbe({ id: environment.id, label: environment.label, report })) ||
      build.installationId !== manifest.installationId || build.request.work.kind !== "environment-build" ||
      build.result?.code !== 0 || build.result.canceled || build.result.interrupted ||
      build.result.image !== environment.rootOrImageDigest) throw new Error("ADMISSION_BUILD_PROOF_REQUIRED");
  const controller = manifest.roles.find(role => role.role === value.controllerRole && role.kind === "worker-controller");
  const worker = manifest.roles.find(role => role.role === value.workerRole && role.kind === "worker");
  const source = manifest.executionProfiles?.find(profile => profile.id === value.sourceProfileId);
  if (!controller?.environmentIds || !worker?.environmentIds || !source ||
      source.backend !== "docker" || source.roles.length !== 1 || source.roles[0] !== worker.role ||
      source.profile !== profileFor(environment) || source.kinds.includes("environment-build") ||
      manifest.executionProfiles?.some(profile => profile.id === value.profileId || profile.image === environment.rootOrImageDigest)) {
    throw new Error("ADMISSION_EXPLICIT_WORKER_PROFILE_REQUIRED");
  }
  const candidate = InstallationRolesSchema.parse({ ...manifest,
    roles: manifest.roles.map(role => role === controller || role === worker
      ? { ...role, environmentIds: [...new Set([...role.environmentIds ?? [], environment.id])] } : role),
    executionProfiles: [...manifest.executionProfiles ?? [],
      { ...source, id: value.profileId, image: environment.rootOrImageDigest }],
  });
  const route = signedEnvironmentAdmission(candidate, environment);
  if (!route || route.controllerRole !== controller.role || route.workerRole !== worker.role ||
      !route.profileIds.includes(value.profileId)) throw new Error("ADMISSION_ROUTE_INCOMPLETE");
  return { manifest: candidate, review: {
    installationId: manifest.installationId, sourceManifestDigest: controlDigest(canonicalJson(manifest)),
    candidateManifestDigest: controlDigest(canonicalJson(candidate)), environmentId: environment.id,
    image: environment.rootOrImageDigest, buildExecutionId: build.id,
    buildReleaseId: build.binding.release.releaseId, sourceProfileId: source.id, ...route,
  } };
}

export async function admissionProposalCommand(path: string | undefined) {
  const file = z.string().min(1).parse(path);
  return proposeEnvironmentAdmission(AdmissionProposalSchema.parse(JSON.parse(await readFile(file, "utf8"))));
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await admissionProposalCommand(process.argv[2]), null, 2)); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(error.message); process.exitCode = 1;
  }
}
