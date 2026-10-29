import { z } from "zod";
import { EnvironmentSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";

/** R preprocessing is offered only by the configured knitr environment. */
export async function mainPathAllowed(context: ModuleContext, environmentId: Id, path: string): Promise<boolean> {
  if (path.endsWith(".tex")) return true;
  if (path !== "main.Rnw" && path !== "main.Rtex") return false;
  const row = z.object({ manifest_json: z.string() }).nullable().parse(
    await context.db.get("SELECT manifest_json FROM environments WHERE id=?", [environmentId]));
  if (!row) return false;
  const environment = EnvironmentSchema.parse(JSON.parse(row.manifest_json));
  return environment.backend === "docker" && environment.helpers.includes("knitr");
}
