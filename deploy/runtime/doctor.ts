import { checked } from "./artifacts";
import { probeEnvironment } from "../../services/compiler/environment";
import { loadConfig } from "@quire/runtime";
import ky from "ky";

export async function deploymentDoctor() {
  const config = loadConfig();
  const tools = await Promise.all(["git", "flock", "bwrap", "systemd-run"].map(async (name) => ({
    name, version: await checked([name, "--version"]),
  })));
  const environment = await probeEnvironment(AbortSignal.timeout(180_000));
  const health: unknown = await ky.get(`http://${config.host}:${config.port}/api/health`, {
    retry: 0, timeout: 10_000,
  }).json();
  return { bun: Bun.version, profile: config.profile, tools, environment, health };
}
if (import.meta.main) {
  const report = await deploymentDoctor();
  console.info(JSON.stringify(report, null, 2));
  if (!report.environment.available) process.exitCode = 1;
}
