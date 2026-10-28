import { readFile } from "node:fs/promises";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Environment } from "@quire/contracts";
import type { Runtime } from "@quire/runtime";
import { digest, ManifestInputSchema, ProbeReportSchema } from "../../../services/operations/environments/model";
import { manifestFromProbe } from "../../../services/operations/environments/probe";

/** Provision accepted persisted state, not a newly claimed probe result.
 * The actual controlled worker independently probes this exact image at startup. */
export async function provisionAcceptedEnvironment(runtime: Runtime, environment: Environment) {
  const report = ProbeReportSchema.parse(JSON.parse(await readFile(
    "docs/evidence/p2o-environments/default-report.json", "utf8")));
  const original = manifestFromProbe({ id: environment.id, label: environment.label, report });
  if (JSON.stringify(original) !== JSON.stringify(environment)) throw new Error("Accepted environment/report mismatch");
  const operator = z.object({ id: IdSchema }).parse(await runtime.db.get("SELECT id FROM users WHERE operator=1"));
  await runtime.uow.run(async tx => {
    await tx.run("INSERT INTO environments(id,label,release,backend,manifest_json,available,created_at,probe_at) VALUES(?,?,?,?,?,1,?,?)",
      [environment.id, environment.label, environment.release, environment.backend, JSON.stringify(environment),
        runtime.clock.now(), environment.probeAt]);
    await tx.run("INSERT INTO environment_receipts(environment_id,report_json,manifest_digest,created_by) VALUES(?,?,?,?)",
      [environment.id, JSON.stringify(report), digest(JSON.stringify(ManifestInputSchema.parse(environment))), operator.id]);
    await tx.run(runtime.db.dialect === "sqlite"
      ? "UPDATE projects SET settings_json=json_set(settings_json,'$.environmentId',?)"
      : "UPDATE projects SET settings_json=jsonb_set(settings_json::jsonb,'{environmentId}',to_jsonb(?::text))::text",
    [environment.id]);
    await tx.run("UPDATE o_worker_policy SET minimum=1,maximum=1,requested=1,sandbox='docker' WHERE id=1");
  });
}
