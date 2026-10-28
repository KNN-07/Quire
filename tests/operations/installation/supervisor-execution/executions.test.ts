import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { connectControl } from "../../../../services/operations/installation/controller-server";
import { describeExecutionSource } from "../../../../services/operations/installation/execution-source";
import { ExecutionExitSchema, ExecutionLaunchSchema, ExecutionSnapshotSchema } from "../../../../services/operations/installation/execution-model";
import { signExecutionCommand } from "../../../../services/operations/installation/execution-protocol";
import { inspectUnit, cgroupPids } from "../../../../services/operations/installation/systemd-process";
import { inspectOwnedContainer } from "../../../../services/operations/installation/execution-docker";
import { executionFixture, id, limits } from "./fixture";

test("real role-authenticated native and Docker executions are bounded, owned, and drained before stopped authority", async () => {
  try {
  await using fixture = await executionFixture();
  const controller = await fixture.start();
  const role = fixture.role();
  if (fixture.prior.data.dialect !== "sqlite") throw new Error("Native fixture required");
  const sourcePath = join(fixture.prior.data.dataRoot, "work/execution-source");
  await mkdir(sourcePath, { mode: 0o700 });
  await writeFile(join(sourcePath, "main.tex"), "\\documentclass{article}\\begin{document}P9 owned source\\end{document}", { mode: 0o600 });
  const source = await describeExecutionSource(sourcePath, limits.workspaceBytes);
  const request = { requestId: id(), profileId: "native", work: { kind: "environment-metadata", source }, limits };
  const native = z.object({ id: z.string(), started: ExecutionSnapshotSchema }).parse(await role.channel.request("start", request));
  expect(native.started.execution?.unit).toStartWith(`quire-${fixture.config.installationId}-exec-`);
  const nativeExit = ExecutionExitSchema.parse(await role.channel.request("wait", { id: native.id }));
  const nativeError = z.object({ bytes: z.string() }).parse(await role.channel.request("read", { id: native.id, stream: "stderr" }));
  expect(nativeExit.code, Buffer.from(nativeError.bytes, "base64").toString()).toBe(0);
  expect(nativeExit.interrupted).toBe(false);
  const output = z.object({ bytes: z.string(), complete: z.boolean() }).parse(await role.channel.request("read", { id: native.id }));
  expect(Buffer.from(output.bytes, "base64").toString()).toContain("pdfTeX");
  expect(output.complete).toBe(true);
  const replay = z.object({ id: z.string() }).parse(await role.channel.request("start", request));
  expect(replay.id).toBe(native.id);
  const changed = await role.channel.request("start", { ...request, limits: { ...limits, wallSeconds: 1 } })
    .then(() => null, (error: unknown) => error);
  expect(changed).toMatchObject({ code: "CONTROL_EXECUTION_CONFLICT" });

  const foreign = await connectControl(join(fixture.roots.sockets, "executions.sock"));
  try {
    const denied = await foreign.request("execution", signExecutionCommand({
      permit: role.permit, channel: role.channel,
    }, { method: "inspect", input: { id: native.started.launch.id } })).then(() => null, (error: unknown) => error);
    expect(denied).toMatchObject({ code: "CONTROL_EXECUTION_UNAUTHENTICATED" });
  } finally { foreign.close(); }

  const docker = z.object({ id: z.string(), started: ExecutionSnapshotSchema }).parse(await role.channel.request("start", {
    requestId: id(), profileId: "docker", work: { kind: "environment-confinement", source }, limits,
  }));
  expect(docker.started.launch.containerId).toMatch(/^[0-9a-f]{64}$/);
  const dockerExit = ExecutionExitSchema.parse(await role.channel.request("wait", { id: docker.id }));
  expect(dockerExit.code).toBe(0);
  expect(await inspectOwnedContainer("/run/docker.sock", docker.started.launch)).toBeNull();

  await writeFile(join(sourcePath, "main.tex"),
    "\\documentclass{article}\\begin{document}\\newcount\\p\\p=0\\loop\\advance\\p by1\\ifnum\\p>0\\repeat\\end{document}", { mode: 0o600 });
  const endless = await describeExecutionSource(sourcePath, limits.workspaceBytes);
  const active = z.object({ id: z.string(), started: ExecutionSnapshotSchema }).parse(await role.channel.request("start", {
    requestId: id(), profileId: "docker", work: { kind: "compile", source: endless, engine: "pdflatex",
      mainFile: "main.tex", draft: false, stopOnFirstError: false }, limits,
  }));
  const runningUnit = await inspectUnit(fixture.config, active.started.launch.unit);
  expect(runningUnit.state).toBe("active");
  await controller.request("stop", { command: fixture.update, release: fixture.accepted });
  expect(await cgroupPids(runningUnit.cgroup)).toEqual([]);
  expect(await inspectOwnedContainer("/run/docker.sock", active.started.launch)).toBeNull();
  const records = z.object({ launches: z.array(ExecutionLaunchSchema) }).parse(await controller.request("records", {}));
  expect(records.launches.every(launch => ["exited", "interrupted", "released"].includes(launch.state))).toBe(true);
  expect(records.launches.find(launch => launch.id === active.id)?.result?.canceled).toBe(true);
  } catch (error) {
    if (error instanceof SuppressedError) console.error("P9_FAILURE_DETAILS", error.error, error.suppressed);
    throw error;
  }
}, 180000);

test("environment image build executes in one owned builder container and publishes only its observed result", async () => {
  await using fixture = await executionFixture();
  await fixture.start();
  const role = fixture.role();
  if (fixture.prior.data.dialect !== "sqlite") throw new Error("Native fixture required");
  const sourcePath = join(fixture.prior.data.dataRoot, "work/build-source");
  await mkdir(join(sourcePath, "fonts"), { recursive: true, mode: 0o700 });
  const source = await describeExecutionSource(sourcePath, limits.workspaceBytes);
  const build = z.object({ id: z.string(), started: ExecutionSnapshotSchema }).parse(await role.channel.request("start", {
    requestId: id(), profileId: "docker", work: { kind: "environment-build", source, operationId: id(),
      packages: [], mirror: "https://archive.ubuntu.com/ubuntu/" }, limits,
  }));
  const result = ExecutionExitSchema.parse(await role.channel.request("wait", { id: build.id }));
  const diagnostic = z.object({ bytes: z.string() }).parse(await role.channel.request("read", { id: build.id, stream: "stderr" }));
  expect(result.code, Buffer.from(diagnostic.bytes, "base64").toString()).toBe(0);
  expect(result.image).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(result.image).not.toBe(fixture.image);
  expect(await inspectOwnedContainer("/run/docker.sock", build.started.launch)).toBeNull();
  const probe = z.object({ id: z.string() }).parse(await role.channel.request("start", {
    requestId: id(), profileId: result.image, work: { kind: "environment-confinement", source }, limits,
  }));
  expect(ExecutionExitSchema.parse(await role.channel.request("wait", { id: probe.id })).code).toBe(0);
}, 180000);

test("controller death retains exact Docker inventory and restart removes old children without inventing payload results", async () => {
  await using fixture = await executionFixture();
  let controller = await fixture.start();
  const role = fixture.role();
  if (fixture.prior.data.dialect !== "sqlite") throw new Error("Native fixture required");
  const sourcePath = join(fixture.prior.data.dataRoot, "work/crash-source");
  await mkdir(sourcePath, { mode: 0o700 });
  await writeFile(join(sourcePath, "main.tex"),
    "\\documentclass{article}\\begin{document}\\newcount\\p\\p=0\\loop\\advance\\p by1\\ifnum\\p>0\\repeat\\end{document}", { mode: 0o600 });
  const source = await describeExecutionSource(sourcePath, limits.workspaceBytes);
  const launched = z.object({ id: z.string(), started: ExecutionSnapshotSchema }).parse(await role.channel.request("start", {
    requestId: id(), profileId: "docker", work: { kind: "compile", source, engine: "pdflatex",
      mainFile: "main.tex", draft: false, stopOnFirstError: false }, limits,
  }));
  const unit = await inspectUnit(fixture.config, launched.started.launch.unit);
  await fixture.killController();
  controller = await fixture.start();
  expect(await cgroupPids(unit.cgroup)).toEqual([]);
  expect(await inspectOwnedContainer("/run/docker.sock", launched.started.launch)).toBeNull();
  const records = z.object({ launches: z.array(ExecutionLaunchSchema) }).parse(await controller.request("records", {}));
  expect(records.launches.find(launch => launch.id === launched.id)).toMatchObject({
    state: "interrupted", report: null, result: { interrupted: true },
  });
}, 180000);
