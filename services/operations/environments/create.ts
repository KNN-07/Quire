import { EnvironmentSchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import { z } from "zod";
import { ControlError } from "../installation/model";
import { assertSupported, digest, profileFor } from "./model";
import type { ManifestInputSchema } from "./model";
import { probeImage } from "./probe";
import { saveEnvironment } from "./registry";
import type { EnvironmentActor } from "./registry";
import { superviseEnvironmentWork } from "./lifecycle";

export function createEnvironment(context: ModuleContext, input: z.infer<typeof ManifestInputSchema>, actor: EnvironmentActor & {readonly key:string}) {
  return superviseEnvironmentWork(context,async signal=>{
  signal.throwIfAborted();
  const requested = EnvironmentSchema.parse({...input,available:false,probeAt:null});
  assertSupported(requested);
  const hash = digest(JSON.stringify(input));
  const prior = await context.db.get("SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?",
    [actor.id,actor.key,"environment-create"]);
  if (prior) {
    const row = z.object({request_digest:z.string(),response_json:z.string()}).parse(prior);
    if (row.request_digest !== hash) throw new ServiceError("IDEMPOTENCY_CONFLICT",409,"Create key belongs to a different manifest");
    return EnvironmentSchema.parse(JSON.parse(row.response_json));
  }
  if (await context.db.get("SELECT id FROM environments WHERE id=?",[requested.id])) {
    throw new ServiceError("IMMUTABLE_ENVIRONMENT",409,"Environment IDs cannot be overwritten");
  }
  const report = await probeImage(requested.rootOrImageDigest,profileFor(requested),signal).catch((error:unknown)=>{
    if (error instanceof ControlError) {
      switch (error.code) {
        case "CONTROL_EXECUTION_PROFILE_REQUIRED":
          throw new ServiceError("ENVIRONMENT_EXECUTION_PROFILE_REQUIRED",409,
            "No reviewed execution profile or successful installation-owned build is available for this exact image. Build it through this installation's environment builder or ask an operator to provision a reviewed profile, then retry.");
        case "CONTROL_EXECUTION_POLICY_DENIED":
          throw new ServiceError("ENVIRONMENT_EXECUTION_POLICY_DENIED",403,
            "The reviewed execution policy does not permit this environment probe. Ask an operator to check the API role, work kind, resource limits and profile compatibility before retrying.");
      }
    }
    throw error;
  });
  if (requested.release !== report.release || requested.packagesDigest !== report.packagesDigest) {
    report.checks.push({name:"declaration",code:65,detail:"Declared release/package digest differs from executed image"});
    report.available = false;
  }
  const manifest = EnvironmentSchema.parse({...requested,available:report.available,probeAt:report.at});
  signal.throwIfAborted();
  return saveEnvironment(context,{manifest,report,actor,receipt:{key:actor.key,digest:hash}});
  });
}
