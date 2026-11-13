import { expect, test } from "bun:test";
import { ExecutionSourceSchema, ExecutionTaskSchema, ExecutionWorkSchema, executionOutputLimits } from "../../../services/operations/installation/execution-model";
import { executionRecipe } from "../../../services/operations/installation/execution-recipes";

const source = ExecutionSourceSchema.parse({ path: "/owned/work/source", digest: "a".repeat(64) });
const work = { kind: "document-convert", source, mainFile: "input $(touch marker).md", from: "markdown", to: "docx" };
const limits = { wallSeconds: 60, memoryBytes: 536870912, processes: 64, workspaceBytes: 67108864 };
test("Pandoc recipes reject caller commands, formats, traversal and output selection", () => {
  expect(ExecutionWorkSchema.safeParse(work).success).toBe(true);
  for (const patch of [{ argv: ["sh"] }, { filter: "evil.lua" }, { output: "/etc/passwd" },
    { image: `sha256:${"a".repeat(64)}` }, { from: "markdown+raw_html" }, { to: "pdf" },
    { mainFile: "../escape" }, { mainFile: "/etc/passwd" }]) {
    expect(ExecutionWorkSchema.safeParse({ ...work, ...patch }).success).toBe(false);
  }
  expect(ExecutionWorkSchema.safeParse({ kind: "pandoc-probe", source, argv: ["sh"] }).success).toBe(false);
});
test("Pandoc commands use fixed entrypoints and positional arguments with exact output ceilings", () => {
  const task = ExecutionTaskSchema.parse({ launchId: crypto.randomUUID(), root: "/owned/execution",
    source: "/owned/execution/source", containerId: null, dockerSocket: "/run/docker.sock",
    request: { requestId: crypto.randomUUID(), profileId: "pandoc", limits, work },
    profile: { id: "pandoc", roles: ["api"], kinds: ["document-convert", "pandoc-probe"],
      backend: "docker", image: `sha256:${"a".repeat(64)}`, limits, maxConcurrent: 2 },
  });
  const recipe = executionRecipe(task);
  expect(recipe.slice(0, 4)).toEqual(["/bin/sh", "-c", '/usr/bin/pandoc "$@" && /usr/bin/zip -q -r - .', "quire-convert"]);
  expect(recipe.at(-1)).toBe("/src/input $(touch marker).md");
  expect(recipe).toContain("/work/document.docx");
  expect(executionRecipe({ ...task, request: { ...task.request, work: { kind: "pandoc-probe", source } } }))
    .toEqual(["/usr/bin/pandoc", "--version"]);
  expect(() => executionRecipe({ ...task, profile: { ...task.profile, backend: "bwrap" } }))
    .toThrow("CONTROL_EXECUTION_POLICY_DENIED");
  expect(executionOutputLimits("pandoc-probe")).toEqual({ stdout: 16384, stderr: 65536 });
  expect(executionOutputLimits("document-convert")).toEqual({ stdout: 67108864, stderr: 65536 });
  expect(executionOutputLimits("compile")).toEqual({ stdout: 67108864, stderr: 8388608 });
});
