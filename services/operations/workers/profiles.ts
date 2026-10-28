import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertNever, EnvironmentSchema, IdSchema } from "@quire/contracts";
import type { Environment, Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { nativeEnvironmentId } from "../../compiler/environment";
import { resolveEnvironment } from "../environments/registry";

export type PoolSelection = {
  readonly backend: Environment["backend"]; readonly ids?: readonly Id[];
};
export async function poolEnvironments(context: Pick<ModuleContext, "db" | "services">,
  selection: PoolSelection): Promise<readonly Environment[]> {
  const rows = await context.db.all<{ id: string; manifest_json: string }>(`SELECT id,manifest_json
    FROM environments WHERE backend=? AND available=1 AND retired_at IS NULL ORDER BY id`, [selection.backend]);
  const selected = rows.filter(row => !selection.ids || selection.ids.some(id => id === row.id));
  if (!selected.length) throw new ServiceError("WORKER_ENVIRONMENTS_UNAVAILABLE", 503, "No available environment matches this pool backend and configured IDs");
  switch (selection.backend) {
    case "bwrap": {
      const manifests = selected.map(row => EnvironmentSchema.parse(JSON.parse(row.manifest_json)));
      if (manifests.some(environment => environment.id !== nativeEnvironmentId || environment.backend !== "bwrap" || !environment.available)) {
        throw new ServiceError("WORKER_ENVIRONMENT_UNTRUSTED", 503, "Native workers require the accepted native environment identity");
      }
      return manifests;
    }
    case "docker": {
      const installed = await context.db.get(context.db.dialect === "sqlite"
        ? "SELECT name FROM sqlite_master WHERE type='table' AND name='environment_receipts'"
        : "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='environment_receipts'");
      if (!installed) throw new ServiceError("WORKER_ENVIRONMENT_UNTRUSTED", 503, "Install the verified environment registry before enabling Docker workers");
      return Promise.all(selected.map(row => resolveEnvironment(context, IdSchema.parse(row.id))));
    }
    default: return assertNever(selection.backend);
  }
}
export function poolDirectory(context: Pick<ModuleContext, "config">, owner: string): string {
  return join(context.config.dataDir, "work", "worker-pools", owner);
}
export function roleDirectory(context: Pick<ModuleContext, "config">, owner: string, id: Id): string {
  return join(poolDirectory(context, owner), id);
}
export async function writeWorkerManifest(context: Pick<ModuleContext, "config">, owner: string, role: {
  readonly id: Id; readonly environments: readonly Environment[];
}): Promise<string> {
  const directory = roleDirectory(context, owner, role.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "environments.json");
  await writeFile(path, JSON.stringify(role.environments), { mode: 0o600, flag: "wx" });
  return path;
}
