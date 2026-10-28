import { expect, test } from "bun:test";
import { EnvironmentSchema } from "@quire/contracts";
import { validateDockerPdf } from "../../workers/compiler/pdf-validation";
import { fixtureIds as ids } from "../fixtures/foundation";

test("confined Docker PDF validator rejects a header-only artifact", async () => {
  // Given: the actual immutable compiler image and malformed PDF bytes.
  const child = Bun.spawn(["docker", "image", "inspect",
    process.env["QUIRE_TEST_ENVIRONMENT_IMAGE"] ?? "quire-p2o-environments:st_01a17c2c",
    "--format", "{{.Id}}"], { stdout: "pipe", stderr: "pipe" });
  const [image, errors, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new TypeError(`Compiler image unavailable: ${errors}`);
  const environment = EnvironmentSchema.parse({
    id: ids.environment, label: "Validator image fixture", release: "test", backend: "docker",
    rootOrImageDigest: image.trim(), engines: [], helpers: [], packagesDigest: "0".repeat(64),
    experimental: false, available: false, probeAt: null,
  });
  // When: the real isolated renderer receives a signature without valid PDF pages.
  const error = await validateDockerPdf(new TextEncoder().encode("%PDF-1.7\ninvalid"), environment,
    AbortSignal.timeout(30000)).then(() => null, (failure: unknown) => failure);
  // Then: the trusted worker cannot issue a successful validation receipt.
  expect(error).toMatchObject({ code: "INVALID_PDF" });
}, 45000);
