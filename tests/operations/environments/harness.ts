import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createRuntime, loadConfig } from "@quire/runtime";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as core, migrations as coreMigrations } from "../../../services/core/base";
import { register as compiler, migrations as compilerMigrations, stopWorker } from "../../../services/compiler";
import { register, migrations, stopEnvironmentBuilds } from "../../../services/operations/environments";
import { register as tasks } from "../../../services/operations/tasks";
import { seed } from "../../../scripts/seed";

export async function environmentFixture() {
  const root = await mkdtemp(join(tmpdir(),"quire-environments-http-"));
  const runtime = await createRuntime(loadConfig({QUIRE_DATA_DIR:root}),{modules:[
    {id:"010-a-identity",lane:"A",order:10,register:identity,migrations:identityMigrations},
    {id:"020-k-core",lane:"K",order:20,register:core,migrations:coreMigrations},
    {id:"030-c-compiler",lane:"C",order:30,register:compiler,migrations:compilerMigrations},
    {id:"042-o-tasks",lane:"O",order:42,register:tasks},
    {id:"060-o-environments",lane:"O",order:60,register,migrations},
  ]}).catch(async(error:unknown)=>{await rm(root,{recursive:true,force:true});throw error;});
  const password = "environment-fixture-password-2026";
  let server:ReturnType<typeof Bun.serve>;
  try {
    await seed(runtime,password);
    server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:request => runtime.routes.fetch(request)});
  } catch(error) {
    try {await stopEnvironmentBuilds(runtime);await stopWorker(runtime);await runtime.close();}
    finally {await rm(root,{recursive:true,force:true});}
    throw error;
  }
  const request = (path:string,init:RequestInit={}) => {
    const headers = new Headers(init.headers);
    headers.set("origin","http://localhost:5173");
    if (init.body) headers.set("content-type","application/json");
    return fetch(new URL(path,server.url),{...init,headers,signal:AbortSignal.timeout(180000)});
  };
  const login = async (email="operator@quire.local") => {
    const response = await request("/api/auth/login",{method:"POST",body:JSON.stringify({email,password})});
    if (!response.ok) throw new TypeError(`Login failed: ${response.status}`);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Missing session");
    const me = await request("/api/me",{headers:{cookie}});
    const csrf = z.object({data:z.object({csrfToken:z.string()})}).parse(await me.json()).data.csrfToken;
    const headers = {cookie,"x-csrf-token":csrf};
    const principal=await runtime.services.get("identity").require(new Request(server.url,{headers}));
    return {headers,actor:{id:principal.user.id,sessionId:principal.sessionId},get:(path:string)=>request(path,{headers}),
      write:(path:string,body:unknown,key=crypto.randomUUID())=>request(path,{method:"POST",
        headers:{...headers,"idempotency-key":key},body:JSON.stringify(body)})};
  };
  return {runtime,context:{...runtime,routes:runtime.routes.forLane("O")},server,request,login,
    [Symbol.asyncDispose]:async()=>{
      await server.stop(true); await stopEnvironmentBuilds(runtime); await stopWorker(runtime); await runtime.close(); await rm(root,{recursive:true,force:true});
    }};
}
