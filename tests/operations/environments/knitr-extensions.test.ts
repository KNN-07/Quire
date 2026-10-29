import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { CompileJobSchema } from "@quire/contracts";
import { CoreProjects } from "../../../services/core/base";
import { startWorker } from "../../../services/compiler";
import { saveEnvironment } from "../../../services/operations/environments/registry";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { environmentFixture } from "./harness";
import { verifiedReport } from "./image";

test.each([
  ["main.Rtex", false], ["main.Rtex", true], ["main.Rnw", true],
] as const)("isolated knitr main %s enforces cache policy %s", async (mainPath, cache) => {
  await using fixture = await environmentFixture();
  const operator = await fixture.login();
  const user = await fixture.login("kien@quire.local");
  const report = await verifiedReport("knitr");
  const manifest = manifestFromProbe({ id: crypto.randomUUID(), label: "Knitr extension proof", report });
  await saveEnvironment(fixture.context, { manifest, report, actor: operator.actor });
  const evidence = `docs/evidence/p64-knitr/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  await Bun.write("docs/evidence/p64-knitr/knitr-report.json", JSON.stringify(report, null, 2));
  const options = `calculation,echo=FALSE,results='asis',cache=${cache ? "TRUE" : "FALSE"}`;
  const code = 'cat("QUIREKNITREXTENSION",sum(1:10),sep="")';
  const chunk = mainPath === "main.Rtex" ? `% begin.rcode ${options}\n% ${code}\n% end.rcode`
    : `<<${options}>>=\n${code}\n@`;
  const source = `\\documentclass{article}
\\begin{document}
${chunk}
\\end{document}
`;
  const core = new CoreProjects(fixture.context);
  const project = await core.createFromFiles(user.actor.id, {
    name: `Knitr ${mainPath} cache ${cache}`, mainPath, environmentId: manifest.id,
    entries: [{ path: mainPath, bytes: new TextEncoder().encode(source) }],
  });
  const scope = { projectId: project.id, branch: project.defaultBranch };
  expect((await core.listFiles(scope)).map(file => file.path)).toEqual([mainPath]);
  const terminal = Promise.withResolvers<void>();
  const completed = new Set<string>();
  let expected: string | undefined;
  const unsubscribe = fixture.runtime.events.subscribe(event => {
    if (event.topic !== "job.changed" || ["queued", "running"].includes(event.payload.status)) return;
    completed.add(event.payload.resourceId);
    if (expected === event.payload.resourceId) terminal.resolve();
  });
  const timeout = setTimeout(() => terminal.reject(new Error("Knitr extension compile deadline")), 120_000);
  void terminal.promise.catch(() => undefined);
  try {
    await startWorker(fixture.runtime);
    const response = await user.write(`/api/projects/${project.id}/compiles`, {
      scope, expectedRevision: (await core.getBranch(scope)).revision, clean: true,
    });
    expect(response.status).toBe(202);
    const queued = z.object({ data: CompileJobSchema }).parse(await response.json()).data;
    expected = queued.id;
    if (completed.has(expected)) terminal.resolve();
    await terminal.promise;
    const result = z.object({ data: CompileJobSchema }).parse(
      await (await user.get(`/api/compiles/${queued.id}`)).json()).data;
    expect(result.status).toBe(cache ? "failed" : "succeeded");
    const log = result.artifacts.find(artifact => artifact.kind === "log");
    if (!log) throw new Error("Retained compiler log required");
    const logText = await (await user.get(`/api/artifacts/${log.id}/content`)).text();
    await Bun.write(`${evidence}/build.log`, logText);
    const pdf = result.artifacts.find(artifact => artifact.kind === "pdf");
    if (cache) {
      expect(logText).toContain("QUIRE_KNITR_CACHE_UNSUPPORTED");
      expect(pdf).toBeUndefined();
    } else {
      if (!pdf) throw new Error("Actual Rtex PDF required");
      const download = await user.get(`/api/artifacts/${pdf.id}/content`);
      expect(download.status).toBe(200);
      const bytes = new Uint8Array(await download.arrayBuffer());
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
      await Bun.write(`${evidence}/output.pdf`, bytes);
    }
    expect((await core.readDocument(scope, project.settings.mainFileId)).text).toBe(source);
    await Bun.write(`${evidence}/receipt.json`, JSON.stringify({ utc: new Date().toISOString(),
      root: fixture.runtime.config.dataDir, mainPath, cache, source, project, result }, null, 2));
    console.info("P64_KNITR_RECEIPT", { evidence, mainPath, cache, status: result.status, job: result.id, unit: result.workerId });
  } finally { clearTimeout(timeout); unsubscribe(); }
}, 300_000);
