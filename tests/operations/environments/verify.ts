import { mkdir, writeFile, readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../../services/operations/environments/process";

const evidence = join(import.meta.dir,"../../../docs/evidence/p2o-environments");
async function fingerprint() {
  const hasher = new Bun.CryptoHasher("sha256");
  const visit = async (path:string):Promise<void>=>{
    if ((await stat(path)).isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path,name));
    } else {hasher.update(path);hasher.update(await readFile(path));}
  };
  for (const path of ["services/operations/environments","deploy/compiler","workers/compiler/docker.ts","scripts/ops/environments.ts","tests/operations/environments"]) {
    await visit(path);
  }
  return hasher.digest("hex");
}
const targets=process.argv.slice(2);
const commands = [
  {name:"tests",command:["bun","test",...(targets.length ? targets : ["tests/operations/environments"])],seconds:1200},
  {name:"typecheck",command:["bun","node_modules/typescript/bin/tsc","--noEmit","-p","tests/operations/environments/tsconfig.json"],seconds:120},
  {name:"lint",command:["./node_modules/.bin/oxlint","--type-aware","--deny-warnings","services/operations/environments","workers/compiler/docker.ts","scripts/ops/environments.ts","tests/operations/environments"],seconds:120},
] as const;
if (import.meta.main) {
  await mkdir(evidence,{recursive:true});
  const before = await fingerprint();
  for (const item of commands) {
    const result = await runCommand(item.command,{seconds:item.seconds});
    const text = `$ ${item.command.join(" ")}\n${result.stdout}${result.stderr}\nEXIT_CODE=${result.code}\n`;
    await writeFile(join(evidence,`${item.name}-final.log`),text);
    console.log(text);
    if (result.code !== 0) {process.exitCode=1;break;}
  }
  const after = await fingerprint();
  await writeFile(join(evidence,"input-fingerprint.json"),JSON.stringify({before,after,unchanged:before===after},null,2));
  if (before!==after) {console.error("Owned verification inputs changed during the run");process.exitCode=1;}
}
