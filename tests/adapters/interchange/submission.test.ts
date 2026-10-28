import { test, expect } from "bun:test";
import { z } from "zod";
import { CoreProjects, downloadOperation, readZip } from "../../../services/core/base";
import { InterchangeExports, PandocConverter } from "../../../services/adapters/interchange";
import { compilerFixture, fixtureIds, terminalEvent } from "../../compiler/fixtures";
import { retainEvidence } from "./harness";

test("packages actual compiled PDF and BBL separately from source when exporting a submission", async () => {
  // Given
  await using runtime = await compilerFixture({ integrated: true });
  const context = { ...runtime, routes: runtime.routes.forLane("X") };
  const projects = new CoreProjects(context);
  const project = await projects.createFromFiles(fixtureIds.kien, { name: "Actual submission", entries: [
    { path: "main.tex", bytes: new TextEncoder().encode("\\documentclass{article}\n\\begin{document}\nA real citation \\cite{fixture}.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n") },
    { path: "refs.bib", bytes: new TextEncoder().encode("@book{fixture,author={Ada Lovelace},title={Interchange fixture},year={2026},publisher={Quire}}\n") },
    { path: "raw.bin", bytes: new Uint8Array([0, 255, 37]) },
  ] });
  const scope = { projectId: project.id, branch: "main" };
  const compiler = runtime.services.get("compiler");
  const done = terminalEvent(runtime);
  const job = await compiler.enqueue(fixtureIds.kien, { scope,
    expectedRevision: (await projects.getBranch(scope)).revision, settings: project.settings, clean: true }, "actual-submission-compile");
  await runtime.start();
  await done;
  const complete = await compiler.get(fixtureIds.kien, job.id);
  expect(complete.status).toBe("succeeded");
  // When
  const exporter = new InterchangeExports(projects, new PandocConverter(""));
  const operation = await exporter.export({ actorId: fixtureIds.kien, projectId: project.id,
    snapshotId: complete.snapshot.id, kind: "submission", key: "actual-submission-export" });
  const bytes = await downloadOperation(projects, fixtureIds.kien, { id: operation.id });
  // Then
  const entries = readZip(bytes);
  const manifestEntry = entries.find(file => file.path === "manifest.json");
  if (!manifestEntry) throw new TypeError("Manifest required");
  const manifest = z.object({ source: z.array(z.string()), generated: z.array(z.string()) })
    .parse(JSON.parse(new TextDecoder().decode(manifestEntry.bytes)));
  expect(manifest.source).toEqual(["main.tex", "raw.bin", "refs.bib"]);
  expect(manifest.generated.some(path => path.endsWith(".bbl"))).toBe(true);
  const pdf = entries.find(file => file.path.startsWith("generated/") && file.path.endsWith(".pdf"));
  if (!pdf) throw new TypeError("Real PDF required");
  expect(new TextDecoder().decode(pdf.bytes.subarray(0, 5))).toBe("%PDF-");
  expect(entries.find(file => file.path === "source/raw.bin")?.bytes).toEqual(new Uint8Array([0, 255, 37]));
  expect(entries.some(file => file.path.startsWith("source/") && file.path.endsWith(".bbl"))).toBe(false);
  await retainEvidence("submission.zip", bytes);
  await retainEvidence("submission.pdf", pdf.bytes);
  await retainEvidence("submission-manifest.json", manifestEntry.bytes);
  const bbl = entries.find(file => file.path.startsWith("generated/") && file.path.endsWith(".bbl"));
  if (bbl) await retainEvidence("submission.bbl", bbl.bytes);
}, 360_000);
