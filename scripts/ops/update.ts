import { readFile } from "node:fs/promises";
import { UpdateConfig } from "../../services/operations/updates/model";
import { discover, fetchPackage } from "../../services/operations/updates/feed";

/** Read-only operator validation. Installation is admitted only by the authenticated job API. */
export async function validateUpdateFeed(configPath: string, command: string): Promise<void> {
  const config = UpdateConfig.parse(JSON.parse(await readFile(configPath, "utf8")));
  const releases = await discover(config, new Date().toISOString());
  for (const release of releases) {
    if (command === "validate") await fetchPackage(config, release);
    console.log(JSON.stringify({ id: release.id, version: release.version, security: release.security,
      manifestDigest: release.manifestDigest, packageValidated: command === "validate" }));
  }
}
if (import.meta.main) {
  const [command, path] = process.argv.slice(2);
  if (!path || !["list", "validate"].includes(command ?? "")) {
    console.error("Usage: bun scripts/ops/update.ts <list|validate> <operator-config.json>");
    process.exitCode = 2;
  } else {
    try { await validateUpdateFeed(path, command ?? "list"); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  }
}
