import { expect, test } from "bun:test";
import { build } from "../../workers/compiler/build";
import { parseDiagnostics } from "../../services/compiler/diagnostics";
import { sourceFixture, settings, fixtureIds as ids } from "./fixtures";

test("the actual compiler reports malformed selected main source instead of rejecting persistence syntax", async () => {
  const fixture = sourceFixture("\\documentclas{article}\n\\begin{document}Draft\\end{document}");
  const result = await build({ ...fixture, settings });
  expect(result.success).toBe(false);
  expect(result.log).toContain("Undefined control sequence");
  const diagnostics = parseDiagnostics({ jobId: ids.snapshot, files: fixture.files, log: result.log });
  expect(diagnostics.some(item => item.severity === "error" && item.fileId === ids.mainFile && item.line === 1)).toBe(true);
}, 60000);
