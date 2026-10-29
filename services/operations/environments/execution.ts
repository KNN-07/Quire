import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertNever, ProjectPathSchema } from "@quire/contracts";
import type { Environment } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { BuildInput, BuildResult } from "../../../workers/compiler/build";
import { defaultLimits } from "../../../workers/compiler/sandbox";
import { dockerSandbox } from "../../../workers/compiler/docker";
import { readTar } from "../../../workers/compiler/archive";
import { assertSupported, profileFor } from "./model";

export type ProfileBuildInput = BuildInput & { readonly environment: Environment };
export async function runProfile(input: ProfileBuildInput): Promise<BuildResult> {
  assertSupported(input.environment);
  const profile = profileFor(input.environment);
  if (!input.environment.available || !input.environment.engines.includes(input.settings.engine)) {
    throw new ServiceError("ENVIRONMENT_UNAVAILABLE", 503, "Requested engine has not passed the environment probe");
  }
  const limits = input.limits ?? defaultLimits;
  const main = input.files.find(file => file.id === input.settings.mainFileId);
  if (!main || main.kind !== "file" || !main.editable || main.link ||
      !(main.path.endsWith(".tex") || profile === "knitr" && ["main.Rnw", "main.Rtex"].includes(main.path))) {
    throw new ServiceError("INVALID_MAIN", 422, "Select an editable unlinked TeX main, or main.Rnw/main.Rtex in the knitr profile");
  }
  if (input.files.reduce((sum,file) => sum + file.bytes,0) > limits.workspaceBytes) {
    throw new ServiceError("SOURCE_LIMIT", 422, "Snapshot exceeds the writable workspace budget");
  }
  const source = await mkdtemp(join(tmpdir(), "quire-environment-job-"));
  try {
    for (const file of input.files) {
      const path = join(source, ProjectPathSchema.parse(file.path));
      switch (file.kind) {
        case "folder": await mkdir(path, { recursive: true }); break;
        case "file":
          if (!file.blob) throw new ServiceError("SOURCE_MISSING", 422, file.path);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, await input.blobs.get(file.blob), { mode: 0o400 });
          break;
        default: assertNever(file.kind);
      }
    }
    const result = await dockerSandbox({ source, limits, image: input.environment.rootOrImageDigest,
      installationProfile: profile,
      installationWork: { kind: "compile", engine: input.settings.engine, mainFile: main.path,
        draft: input.settings.draft, stopOnFirstError: input.settings.stopOnFirstError },
      command: ["/usr/local/bin/quire-compile", profile, input.settings.engine, main.path,
        String(input.settings.stopOnFirstError), String(input.settings.draft)],
      ...(input.signal ? { signal: input.signal } : {}), ...(input.unitId ? { unitId: input.unitId } : {}) });
    const files = readTar(result.stdout);
    const pdf = files.get("output.pdf");
    return { files, log: result.stderr, code: result.code, unit: result.unit,
      success: result.code === 0 && !result.canceled && !!pdf &&
        new TextDecoder().decode(pdf.subarray(0,5)) === "%PDF-" };
  } finally { await rm(source, { recursive: true, force: true }); }
}
