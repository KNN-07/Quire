import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionTaskSchema, ExecutionWorkSchema } from "../../../../services/operations/installation/execution-model";
import { describeExecutionSource, removeExecutionFiles, sealExecutionSource } from "../../../../services/operations/installation/execution-source";
import { id, limits } from "./fixture";

test("environment execution accepts pinned approved packages and rejects unversioned or arbitrary commands", () => {
  const request = { kind: "environment-build", operationId: id(), mirror: "https://archive.ubuntu.com/ubuntu/",
    source: { path: "/owned/work/source", digest: "a".repeat(64) }, packages: ["fonts-dejavu=2.37-8"] };
  expect(ExecutionWorkSchema.safeParse(request).success).toBe(true);
  expect(ExecutionWorkSchema.safeParse({ ...request, packages: ["curl"] }).success).toBe(false);
  expect(ExecutionWorkSchema.safeParse({ ...request, argv: ["/bin/sh"] }).success).toBe(false);
});

test("owned immutable source copy preserves every chunk and rejects a changed source digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "quire-p9-source-"));
  try {
    const sourcePath = join(root, "input");
    const outputRoot = join(root, "execution");
    await mkdir(sourcePath, { mode: 0o700 });
    await mkdir(outputRoot, { mode: 0o700 });
    const bytes = Buffer.alloc(140000, 120);
    await writeFile(join(sourcePath, "main.tex"), bytes, { mode: 0o600 });
    const source = await describeExecutionSource(sourcePath, limits.workspaceBytes);
    const task = ExecutionTaskSchema.parse({
      launchId: id(), root: outputRoot, source: join(outputRoot, "source"), containerId: null, dockerSocket: null,
      profile: { id: "native", roles: ["api"], kinds: ["compile"], backend: "bwrap", limits, maxConcurrent: 1 },
      request: { requestId: id(), profileId: "native", limits, work: { kind: "compile", source, engine: "pdflatex",
        mainFile: "main.tex", draft: false, stopOnFirstError: false } },
    });
    await sealExecutionSource(task, new AbortController().signal);
    expect(await readFile(join(outputRoot, "source/main.tex"))).toEqual(bytes);
    expect((await lstat(join(outputRoot, "source"))).mode & 0o222).toBe(0);
    await writeFile(join(sourcePath, "main.tex"), "changed");
    expect(await sealExecutionSource({ ...task, source: join(outputRoot, "changed") }, new AbortController().signal)
      .then(() => null, (error: unknown) => error)).toMatchObject({ code: "CONTROL_EXECUTION_SOURCE_CHANGED" });
  } finally { await removeExecutionFiles(root); }
  expect(await lstat(root).then(() => true, () => false)).toBe(false);
});
