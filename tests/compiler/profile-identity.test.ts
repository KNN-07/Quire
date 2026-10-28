import { expect, test } from "bun:test";
import { EnvironmentSchema } from "@quire/contracts";
import { assertEnvironmentIdentity } from "../../workers/compiler/profiles";
import { fixtureIds as ids } from "../fixtures/foundation";

const manifest = EnvironmentSchema.parse({
  id: ids.environment, label: "Identity fixture", release: "2025", backend: "bwrap",
  rootOrImageDigest: `native:${"a".repeat(64)}`, packagesDigest: "b".repeat(64),
  engines: ["pdflatex", "xelatex"], helpers: ["bibtex", "synctex"],
  experimental: false, available: true, probeAt: "2026-10-27T00:00:00.000Z",
});

test("worker compares execution identity, not cosmetic manifest labels", () => {
  expect(() => assertEnvironmentIdentity(manifest, { ...manifest, label: "Local probe" })).not.toThrow();
  for (const altered of [
    { ...manifest, available: false },
    { ...manifest, rootOrImageDigest: `native:${"c".repeat(64)}` },
    { ...manifest, packagesDigest: "d".repeat(64) },
    { ...manifest, release: "2024" },
    { ...manifest, engines: ["xelatex"] as const },
    { ...manifest, helpers: ["bibtex"] },
  ]) {
    expect(() => assertEnvironmentIdentity(manifest, EnvironmentSchema.parse(altered))).toThrow("Worker toolchain differs");
  }
});
