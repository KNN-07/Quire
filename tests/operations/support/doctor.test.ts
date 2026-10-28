import { expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { doctor } from "../../../scripts/ops/doctor";
import { portProbe, toolProbes } from "../../../services/operations/support";
import { supportFixture } from "./fixture";

test("separates required executed native probes from optional providers and persisted profile metadata", async () => {
  // Given: actual local database, Git repository and compiler tooling, without configured SaaS.
  await using fixture = await supportFixture();
  // When: the real doctor executes version commands and a confined compiler/PDF probe.
  const report = await doctor(fixture.context);
  // Then: actual exits determine native readiness; optional providers are not claimed ready.
  expect(report.requiredNative.runtime.bun.compatible).toBe(true);
  expect(report.requiredNative.tools["git"]?.exitCode).toBe(0);
  expect(report.optionalProviders).toMatchObject({ state: "unconfigured", configuredCount: 0, connectivity: "not-probed" });
  expect(report.compilerProfiles.count).toBe(1);
  expect(report.compilerProfiles.previouslyProbed).toBe(0);
  expect(report.apiPort.requiredForOfflineDoctor).toBe(false);
  expect(report.requiredNative.sandbox.state).toBe("ready");
  expect(report.requiredNative.sandbox.exitCode).toBe(0);
  if (process.env["QUIRE_SUPPORT_EVIDENCE"]) {
    const dir = process.env["QUIRE_SUPPORT_EVIDENCE"];
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "doctor-report.json"), JSON.stringify(report, null, 2));
  }
}, 90000);

test("observes a real listener and reports its closed port as degraded", async () => {
  // Given: an actual owned loopback listener.
  const receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 204 }) });
  const port = Number(receiver.url.port);
  // When: port connectivity is probed before and after closing the listener.
  const connected = await portProbe("127.0.0.1", port);
  await receiver.stop(true);
  const closed = await portProbe("127.0.0.1", port);
  // Then: TCP readiness reflects observable connectivity, not configured port presence.
  expect(connected.state).toBe("ready");
  expect(closed.state).toBe("degraded");
});

test("rejects an executable whose real version command exits unsuccessfully", async () => {
  // Given: an owned negative executable fixture, not an advertised compiler profile.
  await using fixture = await supportFixture();
  const bin = join(fixture.path, "negative-bin");
  await mkdir(bin);
  await writeFile(join(bin, "git"), "#!/bin/sh\nexit 73\n", { mode: 0o700 });
  const originalPath = process.env["PATH"];
  try {
    process.env["PATH"] = bin;
    // When: discovery finds the executable but the actual version command fails.
    const probes = await toolProbes();
    // Then: presence alone cannot produce readiness.
    expect(probes["git"]).toEqual({ state: "degraded", exitCode: 73 });
    expect(probes["pdflatex"]?.state).toBe("missing");
  } finally {
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
  }
});

test("reports native degradation when an existing repository is unreadable", async () => {
  // Given: an owned installation whose real seeded Git object store is lost.
  await using fixture = await supportFixture();
  await rm(join(fixture.path, "git"), { recursive: true, force: true });
  // When: doctor probes that configured repository through the actual repository port.
  const report = await doctor(fixture.context);
  // Then: a successful SQL/tool probe cannot mask failed configured source storage.
  expect(report.requiredNative.runtime.repository.state).toBe("degraded");
  expect(report.requiredNative.state).toBe("degraded");
}, 90000);
