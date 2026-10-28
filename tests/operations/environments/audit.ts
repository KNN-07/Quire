import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProbeReportSchema, Profiles, digest } from "../../../services/operations/environments/model";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { runCommand } from "../../../services/operations/environments/process";

if (import.meta.main) {
  const root = join(import.meta.dir,"../../../docs/evidence/p2o-environments");
  await mkdir(root,{recursive:true});
  const bundle = join(root,"environments-cli.bundle.js");
  const bundleBuild = await runCommand(["bun","build","scripts/ops/environments.ts","--target=bun",`--outfile=${bundle}`],{seconds:90});
  if (bundleBuild.code !== 0) throw new TypeError(bundleBuild.stderr);
  const actualImage = await runCommand(["docker","image","inspect","quire-p2o-environments:st_01a17c2c","--format","{{.Id}}"],{seconds:15});
  if (actualImage.code !== 0) throw new TypeError(actualImage.stderr);
  const bundledProbe = await runCommand(["env","QUIRE_COMPILER_RESOURCE_OWNER=st_01a17c2c","bun",bundle,"probe",actualImage.stdout.trim(),"default"],{seconds:180});
  if (bundledProbe.code !== 0) throw new TypeError(bundledProbe.stderr);
  const bundledReport = ProbeReportSchema.parse(JSON.parse(bundledProbe.stdout).report);
  if (!bundledReport.available) throw new TypeError("Bundled CLI failed actual profile probes");
  await writeFile(join(root,"bundled-report.json"),JSON.stringify(bundledReport,null,2));
  await writeFile(join(root,"packaging-final.log"),`$ bun build scripts/ops/environments.ts --target=bun --outfile=${bundle}\n${bundleBuild.stdout}${bundleBuild.stderr}\nEXIT_CODE=${bundleBuild.code}\n$ env QUIRE_COMPILER_RESOURCE_OWNER=st_01a17c2c bun ${bundle} probe ${actualImage.stdout.trim()} default\n${bundledProbe.stderr}\nEXIT_CODE=${bundledProbe.code}\n`);
  const checks = [
    ["containers",["docker","ps","-aq","--filter","label=quire.role=compiler-environment","--filter","label=quire.resource-owner=st_01a17c2c"]],
    ["build-tags",["docker","image","ls","--format","{{.Repository}}:{{.Tag}}","--filter","reference=quire-environment-build:*"]],
  ] as const;
  const cleanup: Record<string,unknown> = {};
  for (const [name,command] of checks) {
    const result = await runCommand(command,{seconds:15});
    if (result.code !== 0 || result.stdout.trim()) throw new TypeError(`Owned cleanup gate ${name}: ${JSON.stringify(result)}`);
    cleanup[name]=result;
  }
  const directories = (await readdir(tmpdir())).filter(name=>name.startsWith("quire-environment-") || name.startsWith("quire-environments-http-"));
  if (directories.length) throw new TypeError(`Owned temporary directories remain: ${directories.join(", ")}`);
  cleanup["temporaryDirectories"]=directories;
  const manifests = [];
  for (const profile of Profiles) {
    const report = ProbeReportSchema.parse(JSON.parse(await readFile(join(root,`${profile}-report.json`),"utf8")));
    if (!report.available) throw new TypeError(`${profile} is not actually available`);
    const hash = digest(`${report.image}:${profile}`);
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
    manifests.push(manifestFromProbe({id,label:`texlive-${report.release}-docker-${profile}`,report}));
  }
  const image = await runCommand(["docker","image","inspect","quire-p2o-environments:st_01a17c2c","--format","{{.Id}}"],{seconds:15});
  if (image.code !== 0 || manifests.some(manifest=>manifest.rootOrImageDigest!==image.stdout.trim())) {
    throw new TypeError("Retained image does not match the executed profile manifests");
  }
  await writeFile(join(root,"worker-environments.json"),JSON.stringify(manifests,null,2));
  const metadata = await runCommand(["pdfinfo",join(root,"tagged.pdf")],{seconds:15});
  if (metadata.code !== 0) throw new TypeError(metadata.stderr);
  await writeFile(join(root,"tagged-pdfinfo.txt"),metadata.stdout);
  const validator = {pdfinfo:{code:metadata.code,output:metadata.stdout},pageRendering:"Performed inside the confined compile",
    veraPDF:{state:"not-installed",result:null},assistiveTechnology:{state:"not-performed",result:null},certification:false};
  await writeFile(join(root,"tagged-validation.json"),JSON.stringify(validator,null,2));
  cleanup["retainedImage"]=image.stdout.trim();
  cleanup["closedListeners"]="Each ephemeral Bun listener was stopped by async disposal before its test process exited.";
  cleanup["productionWrites"]="None; only owned temporary runtimes and local Docker artifacts were used.";
  await writeFile(join(root,"cleanup.json"),JSON.stringify(cleanup,null,2));
  const artifacts = [];
  for (const name of (await readdir(root)).sort()) {
    if (name==="artifacts.json") continue;
    const path = join(root,name);
    if (!(await stat(path)).isFile()) continue;
    const bytes = new Uint8Array(await readFile(path));
    artifacts.push({path:name,bytes:bytes.byteLength,sha256:digest(bytes)});
  }
  await writeFile(join(root,"artifacts.json"),JSON.stringify(artifacts,null,2));
  console.log(JSON.stringify({cleanup,image:image.stdout.trim(),manifests:manifests.map(manifest=>manifest.id),artifacts:artifacts.length},null,2));
}
