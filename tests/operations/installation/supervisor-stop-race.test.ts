import { afterAll, beforeAll, expect, mock, spyOn, test } from "bun:test";
import { ControlError } from "../../../services/operations/installation/model";
import { stopExecutionProcess } from "../../../services/operations/installation/execution-stop";
import * as manager from "../../../services/operations/installation/systemd-process";
import type { UnitIdentity } from "../../../services/operations/installation/systemd-process";
import { executionFixture } from "./supervisor-execution/fixture";

let fixture: Awaited<ReturnType<typeof executionFixture>>;
beforeAll(async () => { fixture = await executionFixture(); }, 30000);
afterAll(async () => { await fixture[Symbol.asyncDispose](); });

function observations() {
  const unit = fixture.config.helperUnit;
  const before: UnitIdentity = { unit, invocationId: "owned-invocation", cgroup: "/owned-old",
    state: "active", mainPid: 101, bindsTo: [], killMode: "control-group", sendSigkill: "yes",
    restart: "no", result: "success", exitCode: 0, exitStatus: 0 };
  const after: UnitIdentity = { ...before, state: "inactive", mainPid: 0, cgroup: "/owned-current" };
  const missing = new ControlError("CONTROL_MANAGER_FAILED",
    `/usr/bin/systemctl: Failed to stop ${unit}: Unit ${unit} not loaded.`);
  return { unit, before, after, missing };
}

test("exact unloaded-unit race waits for the job and independently rechecks manager, PID and both cgroups", async () => {
  const { unit, before, after, missing } = observations();
  const order: string[] = [];
  const attempted = Promise.withResolvers<void>();
  const job = Promise.withResolvers<number>();
  const inspect = spyOn(manager, "inspectUnit").mockImplementation(() => {
    order.push("inspect");
    return Promise.resolve(order.filter(item => item === "inspect").length === 1 ? before : after);
  });
  spyOn(manager, "command").mockImplementation((_config, args) => {
    if (args[2] === "stop") { order.push("stop"); attempted.resolve(); return Promise.reject(missing); }
    order.push("load-state"); return Promise.resolve("not-found");
  });
  spyOn(manager, "cgroupPids").mockImplementation(path => { order.push(path); return Promise.resolve([]); });
  try {
    const completion = stopExecutionProcess(fixture.config, unit, job.promise);
    await attempted.promise;
    expect(inspect).toHaveBeenCalledTimes(1);
    order.push("job-completed");
    job.resolve(1); // Manager job completion is not a successful payload outcome.
    await completion;
    expect(order).toEqual(["inspect", "stop", "job-completed", "inspect", "load-state", "/owned-old", "/owned-current"]);
  } finally { job.resolve(1); mock.restore(); }
});

test("unrelated manager failures and another unit's missing error remain fatal", async () => {
  const { unit, before } = observations();
  for (const failure of [
    new ControlError("CONTROL_MANAGER_FAILED", "/usr/bin/systemctl: Access denied"),
    new ControlError("CONTROL_MANAGER_FAILED", "/usr/bin/systemctl: Failed to stop other.service: Unit other.service not loaded."),
    new ControlError("CONTROL_MANAGER_RESPONSE_LIMIT"),
  ]) {
    const inspect = spyOn(manager, "inspectUnit").mockResolvedValue(before);
    spyOn(manager, "command").mockRejectedValue(failure);
    const pids = spyOn(manager, "cgroupPids").mockResolvedValue([]);
    try {
      expect(await stopExecutionProcess(fixture.config, unit, undefined).then(() => null, (error: unknown) => error)).toBe(failure);
      expect(inspect).toHaveBeenCalledTimes(1);
      expect(pids).not.toHaveBeenCalled();
    } finally { mock.restore(); }
  }
});

test("missing-unit text cannot override any independent absence check", async () => {
  const { unit, before, after, missing } = observations();
  const cases = [
    { state: "loaded", observed: after, occupied: "" },
    { state: "not-found", observed: { ...after, state: "active" }, occupied: "" },
    { state: "not-found", observed: { ...after, mainPid: 202 }, occupied: "" },
    { state: "not-found", observed: after, occupied: before.cgroup },
    { state: "not-found", observed: after, occupied: after.cgroup },
  ];
  for (const item of cases) {
    spyOn(manager, "inspectUnit").mockResolvedValueOnce(before).mockResolvedValue(item.observed);
    spyOn(manager, "command").mockImplementation((_config, args) =>
      args[2] === "stop" ? Promise.reject(missing) : Promise.resolve(item.state));
    spyOn(manager, "cgroupPids").mockImplementation(path => Promise.resolve(path === item.occupied ? [303] : []));
    try {
      expect(await stopExecutionProcess(fixture.config, unit, Promise.resolve(0))
        .then(() => null, (error: unknown) => error)).toMatchObject({ code: "CONTROL_EXECUTION_STOP_UNPROVEN" });
    } finally { mock.restore(); }
  }
});

test("manager failure during fresh absence observation is not suppressed", async () => {
  const { unit, before, after, missing } = observations();
  const failure = new ControlError("CONTROL_MANAGER_FAILED", "Manager connection lost");
  spyOn(manager, "inspectUnit").mockResolvedValueOnce(before).mockResolvedValue(after);
  spyOn(manager, "command").mockRejectedValueOnce(missing).mockRejectedValue(failure);
  try {
    expect(await stopExecutionProcess(fixture.config, unit, undefined).then(() => null, (error: unknown) => error)).toBe(failure);
  } finally { mock.restore(); }
});

test("the same stop proof tears down a real owned process and accepts its already-stopped state", async () => {
  const unit = fixture.config.helperUnit; // Already recorded in the fixture's owned manifest.
  const child = Bun.spawn(["/usr/bin/systemd-run", "--user", "--quiet", "--wait", "--pipe", "--collect",
    "--service-type=exec", `--unit=${unit}`, "--property=KillMode=control-group", "--property=SendSIGKILL=yes",
    "/usr/bin/cat"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const errors = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const deadline = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    const ready = (async () => {
      let text = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`Owned payload exited before readiness: ${await errors}`);
        text += new TextDecoder().decode(chunk.value);
        if (text.length > 256) throw new Error("Unexpected owned payload output");
        if (text.includes("\n")) return text;
      }
    })(); // Subscribe to payload output before sending the trigger.
    await child.stdin.write("OWNED_STOP_READY\n");
    await child.stdin.flush();
    expect(await ready).toBe("OWNED_STOP_READY\n");
    const before = await manager.inspectUnit(fixture.config, unit);
    expect(before.mainPid).toBeGreaterThan(0);
    await stopExecutionProcess(fixture.config, unit, child.exited);
    expect((await manager.inspectUnit(fixture.config, unit)).mainPid).toBe(0);
    expect(await manager.cgroupPids(before.cgroup)).toEqual([]);
    await stopExecutionProcess(fixture.config, unit, child.exited);
    expect((await reader.read()).done).toBe(true);
    console.info("STOP_RACE_REAL_UNIT_CLEANED", unit, await errors);
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
    await stopExecutionProcess(fixture.config, unit, undefined);
    await child.exited;
  }
}, 30000);
