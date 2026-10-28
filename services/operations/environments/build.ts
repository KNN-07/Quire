import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import type { Id, Operation } from "@quire/contracts";
import { referenceBlob, ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { dockerSandbox } from "../../../workers/compiler/docker";
import { defaultLimits } from "../../../workers/compiler/sandbox";
import { PackageSchema, validateMirror, mirrorAddress, fontInput } from "./inputs";
import { digest, ImageSchema, profileFor } from "./model";
import { requireOperator, resolveEnvironment, saveEnvironment } from "./registry";
import type { EnvironmentActor } from "./registry";
import { serializeEnvironmentWork, superviseEnvironmentWork } from "./lifecycle";
import { manifestFromProbe, probeImage } from "./probe";
import { runCommand } from "./process";
import { installationRoleSession } from "../installation/launch";
import { installationSandbox } from "../installation/caller-execution";

export type EnvironmentBuild = {
  readonly baseId: Id; readonly packageList: readonly string[]; readonly fontUploads: readonly Id[]; readonly mirror: string;
};
const OperationRow = z.object({
  id: IdSchema, kind: z.string(), status: z.string(), progress: z.number(),
  result_json: z.string().nullable(), error_code: z.string().nullable(), input_digest: z.string().nullable(),
});
const phases={preparing:0.05,building:0.35,probing:0.7} as const;
async function markPhase(context:ModuleContext,id:Id,phase:keyof typeof phases):Promise<void> {
  await context.uow.run(async tx=>{
    await tx.run("UPDATE operations SET status='running',progress=?,result_json=?,updated_at=?,version=version+1 WHERE id=?",
      [phases[phase],JSON.stringify({blob:null,projectIds:[],operatorOnly:true,phase}),context.clock.now(),id]);
    await context.events.record(tx,{topic:"operation.changed",aggregateId:id,payload:{resourceId:id,status:"running"}});
  });
  await context.events.dispatch();
}
export function buildEnvironment(context: ModuleContext, input: EnvironmentBuild, actor: EnvironmentActor & {readonly key:string}): Promise<Operation> {
  const started=Promise.withResolvers<Operation>();
  let publishedId:Id|null=null;
  const work=superviseEnvironmentWork(context,async signal=>{
  signal.throwIfAborted();
  const mirror = validateMirror(input.mirror);
  const packages = z.array(PackageSchema).max(32).parse(input.packageList);
  if (new Set(packages).size !== packages.length || new Set(input.fontUploads).size!==input.fontUploads.length || input.fontUploads.length > 16) {
    throw new ServiceError("BUILD_INPUT_LIMIT", 422, "Build inputs must be bounded and distinct");
  }
  const base = await resolveEnvironment(context,input.baseId);
  const image = ImageSchema.parse(base.backend === "docker" ? base.rootOrImageDigest : process.env["QUIRE_ENVIRONMENT_BASE_IMAGE"]);
  const hash = digest(JSON.stringify(input));
  const admission = await context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await requireOperator({...context,db:tx},actor);
    await tx.lock("quire:environments");
    const previous = await tx.get(`SELECT o.*,b.input_digest FROM operations o
      LEFT JOIN environment_builds b ON b.operation_id=o.id WHERE actor_id=? AND idempotency_key=?`,[actor.id,actor.key]);
    if (previous) {
      const row = OperationRow.parse(previous);
      if (row.input_digest !== hash) throw new ServiceError("IDEMPOTENCY_CONFLICT",409,"Build key belongs to different input");
      return { existing: true, value: OperationSchema.parse({ id:row.id,kind:row.kind,status:row.status,progress:row.progress,
        result:row.result_json ? JSON.parse(row.result_json) : null,errorCode:row.error_code }) };
    }
    const id = IdSchema.parse(crypto.randomUUID());
    const now = context.clock.now();
    signal.throwIfAborted();
    const initial = {blob:null,projectIds:[],operatorOnly:true,phase:"queued"};
    await tx.run(`INSERT INTO operations(id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at)
      VALUES(?,?,'environment-build','queued',0,?,?,?,?)`,[id,actor.id,JSON.stringify(initial),actor.key,now,now]);
    await tx.run("INSERT INTO environment_builds(operation_id,input_digest) VALUES(?,?)",[id,hash]);
    await context.events.record(tx,{topic:"operation.changed",aggregateId:id,payload:{resourceId:id,status:"queued"}});
    return { existing:false, value:OperationSchema.parse({id,kind:"environment-build",status:"queued",progress:0,result:initial,errorCode:null}) };
  });
  if (admission.existing) {started.resolve(admission.value);return admission.value;}
  await context.events.dispatch();
  const operation=admission.value;
  publishedId=operation.id;
  started.resolve(operation);
  return serializeEnvironmentWork(context,async()=>{
  const tag = `quire-environment-build:${operation.id}`;
  let root:string|null=null;
  let published=false;
  let result: Readonly<Record<string,unknown>> | null = null;
  let errorCode: string | null = null;
  let lastProcessExitCode:number|null=null;
  const installed = installationRoleSession() !== null;
  try {
    signal.throwIfAborted();
    await context.uow.run(async tx=>{await tx.lock("quire:accounts");await requireOperator({...context,db:tx},actor);});
    root=await mkdtemp(join(tmpdir(),"quire-environment-build-"));
    await markPhase(context,operation.id,"preparing");
    let reference:string|undefined;
    if (!installed) {
      const inspect = await runCommand(["docker","image","inspect",image,"--format","{{json .RepoTags}}"],{seconds:15,signal});
      lastProcessExitCode=inspect.code;
      if (inspect.code !== 0) throw new ServiceError("BUILD_BASE_UNAVAILABLE",503,inspect.stderr);
      reference = z.array(z.string()).nullable().parse(JSON.parse(inspect.stdout))?.[0];
      if (!reference) throw new ServiceError("BUILD_BASE_UNNAMED",422,"Retain a local repository tag for this immutable base image");
    }
    await mkdir(join(root,"fonts"));
    const fonts = await Promise.all(input.fontUploads.map(id => fontInput(context,{id,actorId:actor.id})));
    for (const font of fonts) await writeFile(join(root,"fonts",`${font.digest}.${font.extension}`),font.bytes);
    if (fonts.length) {
      const scan = await dockerSandbox({image,source:root,limits:defaultLimits,signal,
        installationProfile:profileFor(base),installationWork:{kind:"environment-fonts"},
        command:["/bin/sh","-ec","for f in /src/fonts/*; do fc-scan --format '%{family}\\n' \"$f\" || exit 65; done"]});
      lastProcessExitCode=scan.code;
      if (scan.code !== 0 || !scan.stdout.length) throw new ServiceError("FONT_PARSE_FAILED",422,scan.stderr);
    }
    let build:{stdout:string;stderr:string;code:number};
    let builtImage:string;
    if (installed) {
      await markPhase(context,operation.id,"building");
      const owned = await installationSandbox({
        source:root,limits:{...defaultLimits,wallSeconds:900},signal,installationProfile:profileFor(base),
        installationWork:{kind:"environment-build",packages,mirror:mirror.href,operationId:operation.id},
      },"docker",image);
      if (!owned) throw new ServiceError("CONTROL_LAUNCH_REQUIRED",503,"Environment build requires its controller");
      build={stdout:new TextDecoder().decode(owned.stdout),stderr:owned.stderr,code:owned.code};
      lastProcessExitCode=owned.code;
      if (owned.code !== 0) throw new ServiceError("ENVIRONMENT_BUILD_FAILED",422,owned.stderr.slice(-12000));
      if (owned.image === null) throw new ServiceError("ENVIRONMENT_BUILD_IMAGE_UNPROVEN",503,"Controller returned no immutable built image");
      builtImage=ImageSchema.parse(owned.image);
    } else {
    const address = packages.length ? await mirrorAddress(mirror) : null;
    const source = `Types: deb\nURIs: ${mirror.href}\nSuites: resolute resolute-updates resolute-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n`;
    await writeFile(join(root,"quire.sources"),source);
    const dockerfile = [
      `FROM ${reference}@${image}`, "USER root",
      "COPY fonts/ /usr/local/share/fonts/quire/",
      ...(packages.length ? [
        "RUN rm -f /etc/apt/sources.list /etc/apt/sources.list.d/*",
        "COPY quire.sources /etc/apt/sources.list.d/quire.sources",
        `RUN apt-get -o Acquire::ForceIPv4=true -o Acquire::https::AllowRedirect=false -o Acquire::http::AllowRedirect=false update && apt-get -o Acquire::ForceIPv4=true -o Acquire::https::AllowRedirect=false -o Acquire::http::AllowRedirect=false install -y --no-install-recommends ${packages.join(" ")} && rm -rf /var/lib/apt/lists/*`,
      ] : []),
      "RUN fc-cache -f && (dpkg-query -W; find /usr/local/share/fonts/quire -type f -exec sha256sum {} \\;) > /opt/quire/packages.tsv",
      "USER 65534:65534",
    ].join("\n") + "\n";
    await writeFile(join(root,"Dockerfile"),dockerfile);
    build = await runCommand(["docker","build","--progress=plain","--network=default",
      ...(address ? ["--add-host",`${mirror.hostname}:${address}`] : []),
      "--label",`quire.environment.operation=${operation.id}`,"--iidfile",join(root,"image.id"),"-t",tag,root],
      {seconds:900,signal,started:()=>markPhase(context,operation.id,"building")});
    lastProcessExitCode=build.code;
    signal.throwIfAborted();
    if (build.code !== 0) throw new ServiceError("ENVIRONMENT_BUILD_FAILED",422,build.stderr.slice(-12000));
    builtImage = ImageSchema.parse((await readFile(join(root,"image.id"),"utf8")).trim());
    }
    signal.throwIfAborted();
    await markPhase(context,operation.id,"probing");
    const report = await probeImage(builtImage,profileFor(base),signal);
    if (report.release !== base.release) {
      report.checks.push({name:"base-release",code:65,detail:"Provisioned image release differs from the selected base"});
      report.available=false;
    }
    const manifest = manifestFromProbe({id:crypto.randomUUID(),label:`${base.label}-custom`,report});
    signal.throwIfAborted();
    await saveEnvironment(context,{manifest,report,actor});
    published=true;
    const bytes = new TextEncoder().encode(JSON.stringify({manifest,report,build:{...build,stdout:build.stdout.slice(-12000)}},null,2));
    const blob = await context.blobs.put(bytes);
    await context.uow.run(async tx => {
      await referenceBlob(tx,{digest:blob,bytes:bytes.length},context.clock);
      await tx.run("UPDATE environment_builds SET environment_id=? WHERE operation_id=?",[manifest.id,operation.id]);
    });
    result = {blob,projectIds:[],operatorOnly:true,mime:"application/json",filename:"environment-build.json",
      environmentId:manifest.id,image:builtImage,available:manifest.available};
    if (!manifest.available) errorCode = "ENVIRONMENT_PROBE_FAILED";
  } catch(error) {
    if (!(error instanceof Error)) throw error;
    errorCode = signal.aborted ? "ENVIRONMENT_BUILD_CANCELED" : error instanceof ServiceError ? error.code :
      error instanceof z.ZodError ? "INVALID_BUILD_INPUT" : "ENVIRONMENT_BUILD_FAILED";
    if (!(signal.aborted || error instanceof ServiceError || error instanceof z.ZodError)) {
      console.error("environment.build.failed",{operationId:operation.id,name:error.name,message:error.message,stack:error.stack});
    }
    result = {blob:null,projectIds:[],operatorOnly:true,reason:error.message,lastProcessExitCode};
  } finally {
    if (root) await rm(root,{recursive:true,force:true});
  }
  if (signal.aborted && !published && !installed) {
    const cleanup=await runCommand(["docker","image","rm",tag],{seconds:30});
    if (cleanup.code!==0 && !cleanup.stderr.includes("No such image")) throw new ServiceError("BUILD_CLEANUP_FAILED",500,cleanup.stderr);
  }
  const terminal = OperationSchema.parse({...operation,status:errorCode==="ENVIRONMENT_BUILD_CANCELED" ? "canceled" : errorCode ? "failed" : "succeeded",progress:1,result,errorCode});
  await context.uow.run(async tx => {
    await tx.lock("quire:environments");
    await tx.run("UPDATE operations SET status=?,progress=1,result_json=?,error_code=?,updated_at=?,version=version+1 WHERE id=?",
      [terminal.status,JSON.stringify(result),errorCode,context.clock.now(),terminal.id]);
    await tx.run(`INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json) VALUES(?,?,?,?,?,?)`,
      [crypto.randomUUID(),context.clock.now(),actor.id,"environment.build",terminal.id,
      JSON.stringify({baseId:input.baseId,inputDigest:hash,status:terminal.status,errorCode})]);
    await context.events.record(tx,{topic:"operation.changed",aggregateId:terminal.id,payload:{resourceId:terminal.id,status:terminal.status}});
  });
  await context.events.dispatch();
  return terminal;
  });
  });
  void work.catch((error:unknown)=>{
    started.reject(error);
    if(publishedId) {
      if(error instanceof Error) console.error("environment.build.supervision.failed",{operationId:publishedId,name:error.name,message:error.message,stack:error.stack});
      else console.error("environment.build.supervision.failed",{operationId:publishedId,errorType:typeof error});
    }
  });
  return started.promise;
}
