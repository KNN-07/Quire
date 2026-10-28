import { expect, test } from "bun:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ControlChannel } from "../../../services/operations/installation/controller-server";
import { ExecutionExitSchema, ExecutionProfileSchema, ExecutionSnapshotSchema, ExecutionWorkSchema } from "../../../services/operations/installation/execution-model";
import type { ExecutionWork } from "../../../services/operations/installation/execution-model";
import { describeExecutionSource } from "../../../services/operations/installation/execution-source";
import { canonicalJson, controlDigest } from "../../../services/operations/installation/protocol";
import { readTar } from "../../../workers/compiler/archive";
import { executionFixture, id, limits } from "./supervisor-execution/fixture";

async function execute(channel: ControlChannel, profileId: string, work: ExecutionWork) {
  const launched = z.object({ id: z.string(), started: ExecutionSnapshotSchema }).parse(
    await channel.request("start", { requestId: id(), profileId, work, limits }));
  const exit = ExecutionExitSchema.parse(await channel.request("wait", { id: launched.id }));
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  for (const [stream, chunks] of [["stdout", output], ["stderr", errors]] as const) {
    let offset = 0;
    for (;;) {
      const chunk = z.object({ bytes: z.base64(), nextOffset: z.number(), complete: z.boolean() }).parse(
        await channel.request("read", { id: launched.id, stream, offset }));
      chunks.push(Buffer.from(chunk.bytes, "base64"));
      if (chunk.complete) break;
      if (chunk.nextOffset <= offset) throw new Error("Execution output did not advance");
      offset = chunk.nextOffset;
    }
  }
  await channel.request("release", { id: launched.id });
  return { exit, stdout: Buffer.concat(output), stderr: Buffer.concat(errors).toString(), started: launched.started };
}

test("native metadata retains the full toolchain fingerprints and actual PDF success marker", async () => {
  await using fixture = await executionFixture();
  await fixture.start();
  if (fixture.prior.data.dialect !== "sqlite") throw new Error("Native fixture required");
  const path = join(fixture.prior.data.dataRoot, "work/recipe-metadata");
  await mkdir(path, { mode: 0o700 });
  const source = await describeExecutionSource(path, limits.workspaceBytes);
  const result = await execute(fixture.role().channel, "native", { kind: "environment-metadata", source });
  expect(result.exit.code, result.stderr).toBe(0);
  expect(result.exit.interrupted).toBe(false);
  const stdout = result.stdout.toString();
  expect(stdout.match(/^pdfTeX /gm)?.length).toBe(2);
  for (const tool of ["XeTeX", "LuaHBTeX", "BibTeX", "biber version", "Latexmk", "SyncTeX"]) {
    expect(stdout).toContain(tool);
  }
  for (const file of ["/usr/bin/pdftex", "/usr/bin/xetex", "/usr/bin/luahbtex", "/usr/bin/latexmk",
    "/usr/bin/biber", "/usr/bin/bibtex.original", "/etc/LatexMk"]) {
    expect(stdout).toContain(`${controlDigest(await readFile(file))}  ${file}`);
  }
  expect(stdout).toMatch(/^[a-f0-9]{64}  -$/m);
  expect(stdout).toEndWith("QUIRE_NATIVE_PROBE_OK\n");
  expect(result.stderr).toMatch(/Pages:\s+1/);
  expect(result.exit.stdoutBytes).toBe(result.stdout.byteLength);
}, 180000);

test("fixed PDF diff recipes return real native and Docker render and comparison archives", async () => {
  await using fixture = await executionFixture();
  // Provision the new signed profile kinds before any controller or role starts.
  const metadataPath = join(fixture.prior.release.target, "installation-roles.json");
  const inventoryPath = join(fixture.prior.release.target, "installation-runtime.json");
  const metadata = z.object({ installationId: z.string(), roles: z.array(z.unknown()),
    executionProfiles: z.array(ExecutionProfileSchema) }).parse(JSON.parse(await readFile(metadataPath, "utf8")));
  const metadataBytes = canonicalJson({ ...metadata, executionProfiles: metadata.executionProfiles.map(profile => ({
    ...profile, kinds: [...profile.kinds, "pdf-diff-render", "pdf-diff-compile"],
  })) });
  const inventory = z.object({ migrations: z.array(z.unknown()), assets: z.array(z.object({
    path: z.string(), digest: z.string(),
  })) }).parse(JSON.parse(await readFile(inventoryPath, "utf8")));
  for (const [path, bytes] of [[metadataPath, metadataBytes], [inventoryPath, canonicalJson({ ...inventory,
    assets: inventory.assets.map(asset => asset.path === "installation-roles.json" ?
      { ...asset, digest: controlDigest(metadataBytes) } : asset),
  })]]) {
    if (!path || bytes === undefined) throw new Error("Missing provisioned asset");
    await chmod(path, 0o600);
    await writeFile(path, bytes);
    await chmod(path, 0o400);
  }
  await fixture.start();
  if (fixture.prior.data.dialect !== "sqlite") throw new Error("Native fixture required");
  const path = join(fixture.prior.data.dataRoot, "work/recipe-diff");
  await mkdir(path, { mode: 0o700 });
  await writeFile(join(path, "main.tex"),
    "\\documentclass{article}\\usepackage[paperwidth=1in,paperheight=1in,margin=.05in]{geometry}\\begin{document}A.\\end{document}", { mode: 0o600 });
  let source = await describeExecutionSource(path, limits.workspaceBytes);
  const channel = fixture.role().channel;
  const input = await execute(channel, "native", { kind: "compile", source, engine: "pdflatex",
    mainFile: "main.tex", draft: false, stopOnFirstError: true });
  expect(input.exit.code, input.stderr).toBe(0);
  const pdf = readTar(input.stdout).get("output.pdf");
  if (!pdf) throw new Error("Actual compiler did not produce input PDF");
  await writeFile(join(path, "from.pdf"), pdf);
  await writeFile(join(path, "to.pdf"), pdf);
  await writeFile(join(path, "diff.tex"), `\\documentclass{article}
\\usepackage[paperwidth=17in,paperheight=11in,margin=0pt]{geometry}
\\usepackage{graphicx,transparent}\\pagestyle{empty}
\\begin{document}\\noindent
\\ifnum\\pdfshellescape=0\\else\\errmessage{Shell escape enabled}\\fi
\\includegraphics[page=1,width=.49\\paperwidth,height=\\paperheight,keepaspectratio]{/src/from.pdf}
\\includegraphics[page=1,width=.49\\paperwidth,height=\\paperheight,keepaspectratio]{/src/to.pdf}
\\end{document}`);
  source = await describeExecutionSource(path, limits.workspaceBytes);
  for (const backend of ["native", "docker"]) {
    const rendered = await execute(channel, backend, { kind: "pdf-diff-render", source });
    expect(rendered.exit.code, rendered.stderr).toBe(0);
    const pages = readTar(rendered.stdout);
    expect([...pages.keys()].sort()).toEqual(["from-1.png", "from-1.ppm", "to-1.png", "to-1.ppm"]);
    for (const name of ["from-1.ppm", "to-1.ppm"]) {
      expect(Buffer.from(pages.get(name) ?? []).subarray(0, 40).toString()).toMatch(/^P6\s+72 72\s+255\s/);
    }
    for (const name of ["from-1.png", "to-1.png"]) {
      const png = Buffer.from(pages.get(name) ?? []);
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([72, 72]);
    }
    const compared = await execute(channel, backend, { kind: "pdf-diff-compile", source });
    expect(compared.exit.code, compared.stderr).toBe(0);
    const files = readTar(compared.stdout);
    expect([...files.keys()].sort()).toEqual(["comparison.png", "diff.pdf"]);
    expect(Buffer.from(files.get("diff.pdf") ?? []).subarray(0, 5).toString()).toBe("%PDF-");
    const preview = Buffer.from(files.get("comparison.png") ?? []);
    expect(preview.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(Math.max(preview.readUInt32BE(16), preview.readUInt32BE(20))).toBe(1600);
  }
  await mkdir(join(path, "missing"), { mode: 0o700 });
  const missing = await describeExecutionSource(join(path, "missing"), limits.workspaceBytes);
  for (const backend of ["native", "docker"]) {
    const failed = await execute(channel, backend, { kind: "pdf-diff-render", source: missing });
    expect(failed.exit.code).toBe(1);
    expect(failed.exit.interrupted).toBe(false);
    expect(failed.stdout.byteLength).toBe(0);
  }
}, 240000);

test("PDF diff work admits only fixed recipe source, not command forwarding", () => {
  const source = { path: "/owned/work/source", digest: "a".repeat(64) };
  for (const kind of ["pdf-diff-render", "pdf-diff-compile"]) {
    expect(ExecutionWorkSchema.safeParse({ kind, source }).success).toBe(true);
    expect(ExecutionWorkSchema.safeParse({ kind, source, argv: ["/bin/sh"] }).success).toBe(false);
    expect(ExecutionWorkSchema.safeParse({ kind, source, file: "/etc/passwd" }).success).toBe(false);
  }
});
