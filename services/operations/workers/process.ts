import { fileURLToPath } from "node:url";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { installationRoleSession } from "../installation/launch";
import { installationExecutionContext } from "../installation/caller-execution-context";

export type ControllerConfig = {
  readonly coordinator: string; readonly bearer: string; readonly environmentIds?: readonly Id[] | undefined;
};
export type ProcessConfig = ControllerConfig & {
  readonly environmentIds: readonly Id[]; readonly environmentsFile?: string;
};
export type WorkerProcess = {
  readonly id: Id; readonly pid: number; readonly unit: string;
  readonly exited: Promise<WorkerExit>;
  stop(): Promise<void>;
  release?(): Promise<void>;
};
export type WorkerExit = { readonly code: number | null; readonly canceled: boolean; readonly interrupted: boolean };
export async function launch(id: Id, config: ProcessConfig): Promise<WorkerProcess> {
  if (installationRoleSession()) {
    const selected = await installationExecutionContext({ kind: "worker", backend: "worker" });
    if (!selected) throw new ServiceError("CONTROL_LAUNCH_REQUIRED", 503, "Worker launch requires its controller");
    const { createInstallationExecutionClient } = await import("../installation/execution-client");
    const execution = await createInstallationExecutionClient(selected.session).start({
      requestId: id, profileId: selected.profile.id, limits: selected.profile.limits,
      work: { kind: "worker", workerId: id, environmentIds: config.environmentIds },
    });
    const started = await execution.started;
    if (started.pid === null) {
      await execution.stop();
      await execution.release();
      throw new ServiceError("CONTROL_EXECUTION_PROCESS_UNPROVEN", 503, "No actual worker process identity");
    }
    return {
      id, pid: started.pid, unit: started.launch.unit,
      exited: execution.exited,
      async stop() { await execution.stop(); await execution.exited; },
      release: () => execution.release(),
    };
  }
  const unit = `quire-worker-${id}.service`;
  const env = {
    ...process.env, QUIRE_COORDINATOR_URL: config.coordinator, QUIRE_WORKER_BEARER: config.bearer,
    QUIRE_WORKER_ID: id, QUIRE_WORKER_ENVIRONMENT_IDS: config.environmentIds.join(","),
    QUIRE_WORKER_ENVIRONMENTS_FILE: config.environmentsFile,
  };
  const child = Bun.spawn([
    "/usr/bin/systemd-run", "--user", "--wait", "--pipe", "--collect", "--expand-environment=no",
    "--service-type=exec", `--unit=${unit}`, `--working-directory=${process.cwd()}`,
    "-p", "MemoryMax=2147483648", "-p", "MemorySwapMax=0", "-p", "TasksMax=64",
    "-p", "CPUQuota=100%", "-p", "KillMode=control-group", "-p", "TimeoutStopSec=5",
    "-p", "NoNewPrivileges=yes", "-p", "RuntimeMaxSec=86400",
    ...["QUIRE_COORDINATOR_URL", "QUIRE_WORKER_BEARER", "QUIRE_WORKER_ID", "QUIRE_WORKER_ENVIRONMENT_IDS"]
      .map(name => `--setenv=${name}`),
    ...(config.environmentsFile ? ["--setenv=QUIRE_WORKER_ENVIRONMENTS_FILE"] : []),
    process.execPath, fileURLToPath(new URL("../../../workers/compiler/main.ts", import.meta.url)),
  ], { env, stdout: "inherit", stderr: "inherit", stdin: "ignore" });
  return { id, pid: child.pid, unit,
    exited: child.exited.then(code => ({ code, canceled: false, interrupted: false })), stop: async () => {
    if (child.exitCode !== null) return;
    const stop = Bun.spawn(["/usr/bin/systemctl", "--user", "stop", unit], { stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([stop.exited, new Response(stop.stderr).text()]);
    if (code !== 0 && child.exitCode === null) {
      throw new ServiceError("WORKER_STOP_FAILED", 503, `Could not stop ${unit}: ${code}: ${stderr}`);
    }
    await child.exited;
  } };
}
export function parseControllerConfig(input: ControllerConfig): ControllerConfig {
  return z.strictObject({
    coordinator: z.url({ protocol: /^https?$/ }),
    bearer: z.string().regex(/^[0-9a-f]{64}$/),
    environmentIds: z.array(IdSchema).min(1).optional(),
  }).parse(input);
}
