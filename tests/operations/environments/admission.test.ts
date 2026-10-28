import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig } from "@quire/runtime";
import { serializeEnvironmentWork, stopEnvironmentBuilds } from "../../../services/operations/environments/lifecycle";
import { runCommand } from "../../../services/operations/environments/process";

test("holds native background admission until failed environment work finishes cleanup",async()=>{
  // Given: real serialized work whose failure cleanup has a controlled completion.
  const root=await mkdtemp(join(tmpdir(),"quire-environment-admission-"));
  const runtime=await createRuntime(loadConfig({QUIRE_DATA_DIR:root}),{modules:[]})
    .catch(async(error:unknown)=>{await rm(root,{recursive:true,force:true});throw error;});
  try {
  const entered=Promise.withResolvers<void>();
  const release=Promise.withResolvers<void>();
  const failure=new TypeError("Controlled fixture work failure");
  const work=serializeEnvironmentWork(runtime,async()=>{
    try {throw failure;}
    finally {entered.resolve();await release.promise;}
  }).catch((error:unknown)=>{if(error!==failure) throw error;});
  try {
    await Promise.race([entered.promise,work]);
    // When: the kernel is asked for a conflicting nonblocking exclusive lease.
    const conflict=await runCommand(["flock","--exclusive","--nonblock",
      "--conflict-exit-code","73",join(root,".admission-writers.lock"),"/bin/true"],{seconds:5});
    // Then: failure cleanup still owns the live background mutation lease.
    expect(conflict.code).toBe(73);
  } finally {release.resolve();await work;}
  } finally {
    await stopEnvironmentBuilds(runtime);
    try {await runtime.close();} finally {await rm(root,{recursive:true,force:true});}
  }
},180000);
