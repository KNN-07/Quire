import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ky from "ky";
import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { ImageSchema, ProfileSchema } from "../../services/operations/environments/model";
import { probeImage, manifestFromProbe } from "../../services/operations/environments/probe";
import { runCommand } from "../../services/operations/environments/process";
import { admissionProposalCommand } from "./environment-admission";

const routes = {
  list: endpoints.adminEnvironments, create: endpoints.environmentCreate,
  default: endpoints.environmentDefault, retire: endpoints.environmentRetire, build: endpoints.environmentBuild,
} as const;
export async function environmentCommand(args: readonly string[]): Promise<unknown> {
  const [command,value,profile] = args;
  if (command === "admission-proposal") return admissionProposalCommand(value);
  if (command === "probe") {
    const image = ImageSchema.parse(value);
    const selected = ProfileSchema.parse(profile ?? "default");
    const report = await probeImage(image,selected);
    const manifest = manifestFromProbe({id:crypto.randomUUID(),label:`texlive-${report.release}-${selected}`,report});
    if (!report.available) process.exitCode = 1;
    return {manifest,report};
  }
  if (command === "bootstrap") {
    const tag = z.string().max(100).regex(/^quire-[a-z0-9_.:-]+$/).parse(value);
    const result = await runCommand(["docker","build","--progress=plain","--label","quire.role=compiler-toolchain",
      "-t",tag,join(import.meta.dir,"../../deploy/compiler")],{seconds:900});
    if (result.code !== 0) throw new ServiceError("ENVIRONMENT_BUILD_FAILED",422,result.stderr);
    const inspect = await runCommand(["docker","image","inspect",tag,"--format","{{.Id}}"],{seconds:30});
    if (inspect.code !== 0) throw new ServiceError("IMAGE_INSPECTION_FAILED",422,inspect.stderr);
    return {image:ImageSchema.parse(inspect.stdout.trim()),tag,build:result};
  }
  const selected = z.enum(["list","create","default","retire","build"]).parse(command);
  const route = routes[selected];
  const cookie = z.string().min(1).parse(process.env["QUIRE_OPERATOR_COOKIE"]);
  const url = new URL(process.env["QUIRE_OPERATOR_URL"] ?? "http://127.0.0.1:3001");
  const raw: unknown = value ? JSON.parse(await readFile(value,"utf8")) : {params:{},query:{},body:undefined};
  const input = route.input.parse(raw);
  let path = route.path;
  for (const [key,item] of Object.entries(input.params)) path = path.replace(`:${key}`,encodeURIComponent(item));
  const target = new URL(path,url);
  for (const [key,item] of Object.entries(input.query)) if (item !== undefined) target.searchParams.set(key,String(item));
  const headers = new Headers({cookie,origin:process.env["QUIRE_OPERATOR_ORIGIN"] ?? "http://localhost:5173"});
  if (route.method !== "GET") headers.set("x-csrf-token",z.string().min(1).parse(process.env["QUIRE_OPERATOR_CSRF"]));
  if (route.idempotent) headers.set("idempotency-key",z.string().min(1).parse(process.env["QUIRE_OPERATION_KEY"]));
  const response = await ky(target,{method:route.method,headers,retry:0,timeout:1_200_000,throwHttpErrors:false,
    ...(input.body === undefined ? {} : {json:input.body})});
  const body: unknown = await response.json();
  if (!response.ok) throw new ServiceError("OPERATOR_REQUEST_FAILED",response.status,JSON.stringify(body));
  const data = z.object({data:route.output}).parse(body).data;
  return {data,versions:response.headers.get("x-environment-versions")};
}
if (import.meta.main) {
  try { console.log(JSON.stringify(await environmentCommand(process.argv.slice(2)),null,2)); }
  catch(error) {
    if (!(error instanceof Error)) throw error;
    console.error("environment.command.failed",{name:error.name,message:error.message});
    process.exitCode = 1;
  }
}
