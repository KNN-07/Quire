import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServiceError } from "@quire/runtime";
import type { Environment } from "@quire/contracts";
import { dockerSandbox } from "./docker";
import { defaultLimits } from "./sandbox";
import { ProjectPathSchema } from "@quire/contracts";
import { profileFor } from "../../services/operations/environments/model";

export async function validateDockerPdf(bytes: Uint8Array, environment: Environment, signal: AbortSignal): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "quire-worker-pdf-"));
  try {
    await writeFile(join(root, "document.pdf"), bytes);
    const result = await dockerSandbox({
      source: root, image: environment.rootOrImageDigest, limits: defaultLimits, signal,
      installationProfile: profileFor(environment),
      installationWork: { kind: "pdf-validate", file: ProjectPathSchema.parse("document.pdf") },
      command: ["pdftoppm", "-scale-to", "16", "/src/document.pdf", "/work/validation"],
    });
    if (result.code !== 0 || result.canceled) {
      throw new ServiceError("INVALID_PDF", 422, "PDF pages cannot be rendered");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}
