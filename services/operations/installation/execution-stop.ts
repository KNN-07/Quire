import { ControlError } from "./model";
import type { SystemdDriverConfig } from "./driver-config";
import { cgroupPids, command, inspectUnit } from "./systemd-process";

/** Called only after the authority has checked exact durable launch ownership. */
export async function stopExecutionProcess(config: SystemdDriverConfig, unit: string, job: Promise<number> | undefined): Promise<void> {
  const before = await inspectUnit(config, unit);
  let unloaded = false;
  if (!["inactive", "failed"].includes(before.state)) {
    try { await command(config, ["/usr/bin/systemctl", "--user", "stop", unit]); }
    catch (error) {
      if (!(error instanceof ControlError) || error.code !== "CONTROL_MANAGER_FAILED" ||
          error.message !== `/usr/bin/systemctl: Failed to stop ${unit}: Unit ${unit} not loaded.`) throw error;
      unloaded = true;
    }
  }
  await job;
  const after = await inspectUnit(config, unit);
  if ((unloaded && await command(config, ["/usr/bin/systemctl", "--user", "show", unit,
    "--property=LoadState", "--value"]) !== "not-found") ||
      !["inactive", "failed"].includes(after.state) || after.mainPid !== 0 ||
      (before.cgroup && (await cgroupPids(before.cgroup)).length !== 0) ||
      (after.cgroup && (await cgroupPids(after.cgroup)).length !== 0)) {
    throw new ControlError("CONTROL_EXECUTION_STOP_UNPROVEN");
  }
}
