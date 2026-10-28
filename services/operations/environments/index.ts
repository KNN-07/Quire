import { endpoints, assertNever, IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { configureCompilerEnvironments } from "../../compiler";
import { build } from "../../../workers/compiler/build";
import { environmentRecord, nativeDigests, resolveEnvironment, listEnvironments, changeEnvironment } from "./registry";
import { createEnvironment } from "./create";
import { buildEnvironment } from "./build";
import { runProfile } from "./execution";

export { migrations } from "./migrations";
export { resolveEnvironment, environmentRecord, listEnvironments, changeEnvironment } from "./registry";
export { createEnvironment } from "./create";
export { buildEnvironment } from "./build";
export { runProfile } from "./execution";
export { probeImage, compileFixture, manifestFromProbe } from "./probe";
export { stopEnvironmentBuilds } from "./lifecycle";
export type { EnvironmentActor } from "./registry";
export type { EnvironmentBuild } from "./build";
export type { Profile, ProbeReport } from "./model";
export type { ProfileBuildInput } from "./execution";
export async function register(context: ModuleContext): Promise<void> {
  if (context.services.has("compiler")) {
    const native = await context.db.get<{manifest_json:string}>("SELECT manifest_json FROM environments WHERE id=?",["00000000-0000-4000-8000-000000000030"]);
    if (native) {
      const record = await environmentRecord(context,IdSchema.parse("00000000-0000-4000-8000-000000000030"));
      if (record.manifest.available) nativeDigests.set(context.services,record.manifest.rootOrImageDigest);
    }
    configureCompilerEnvironments(context,{
      resolve: id => resolveEnvironment(context,id),
      build: async input => {
        const current = await resolveEnvironment(context,input.environment.id);
        if (current.rootOrImageDigest !== input.environment.rootOrImageDigest) {
          throw new ServiceError("ENVIRONMENT_UNTRUSTED",503,"Execution manifest differs from the immutable registry");
        }
        switch (current.backend) {
          case "bwrap": return build(input);
          case "docker": return runProfile(input);
          default: return assertNever(current.backend);
        }
      },
    });
  }
  const authorize = async (request: Request) => {
    const identity = context.services.get("identity");
    const principal = await identity.require(request);
    if (!principal.operator) throw new ServiceError("FORBIDDEN",403,"Operator access required");
    if (request.method !== "GET") await identity.verifyMutation(request,principal);
    return principal;
  };
  context.routes.register(endpoints.adminEnvironments,async (input,request) => {
    await authorize(request.request);
    const page = await listEnvironments(context,{limit:input.query.limit,
      ...(input.query.cursor ? {cursor:input.query.cursor} : {})});
    request.responseHeaders.set("x-environment-versions",JSON.stringify(Object.fromEntries(page.records.map(row => [row.manifest.id,
      {version:row.version,retiredAt:row.retiredAt,isDefault:row.isDefault}]))));
    return {items:page.items,nextCursor:page.nextCursor};
  });
  context.routes.register(endpoints.environmentCreate,async (input,request) => {
    const principal = await authorize(request.request);
    return createEnvironment(context,input.body.manifest,{id:principal.user.id,sessionId:principal.sessionId,key:request.request.headers.get("idempotency-key") ?? ""});
  });
  context.routes.register(endpoints.environmentBuild,async (input,request) => {
    const principal = await authorize(request.request);
    return buildEnvironment(context,input.body,{id:principal.user.id,sessionId:principal.sessionId,key:request.request.headers.get("idempotency-key") ?? ""});
  });
  for (const [endpoint,action] of [[endpoints.environmentDefault,"default"],[endpoints.environmentRetire,"retire"]] as const) {
    context.routes.register(endpoint,async (input,request) => {
      const principal = await authorize(request.request);
      return changeEnvironment(context,{id:input.params.id,expectedVersion:input.body.expectedVersion,action,
        actor:{id:principal.user.id,sessionId:principal.sessionId}});
    });
  }
}
