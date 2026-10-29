import { expect, test } from "bun:test";
import { z } from "zod";
import { EnvironmentSchema } from "@quire/contracts";
import { baseFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test.each([
  [false, "main.Rnw"], [true, "main.Rnw"], [false, "main.Rtex"], [true, "main.Rtex"],
] as const)("standalone knitr main requires a matching manifest: %s %s", async (knitr, mainPath) => {
  // Given: a real persisted environment manifest, with or without knitr capability.
  await using fixture = await baseFixture();
  const row = z.object({ manifest_json: z.string() }).parse(
    await fixture.runtime.db.get("SELECT manifest_json FROM environments WHERE id=?", [ids.environment]));
  const original = EnvironmentSchema.parse(JSON.parse(row.manifest_json));
  if (knitr) {
    const manifest = EnvironmentSchema.parse({ ...original, backend: "docker", helpers: [...original.helpers, "knitr"] });
    await fixture.runtime.db.run("UPDATE environments SET backend=?,manifest_json=? WHERE id=?",
      ["docker", JSON.stringify(manifest), ids.environment]);
  }
  // When: publication selects an Rnw document, without an extra main.tex.
  const result = await fixture.service.createFromFiles(ids.kien, {
    name: "Standalone knitr", mainPath, environmentId: ids.environment,
    entries: [{ path: mainPath, bytes: new TextEncoder().encode(
      "\\documentclass{article}\n\\begin{document}\n<<>>=\n1+1\n@\n\\end{document}\n") }],
  }).then(project => ({ project }), (error: unknown) => ({ error }));
  // Then: only the knitr-capable environment admits the standalone main.
  if (!knitr) {
    expect(result).toMatchObject({ error: { code: "INVALID_MAIN" } });
    return;
  }
  if (!("project" in result)) throw new TypeError("Expected admitted knitr project");
  await fixture.restart();
  const file = await fixture.service.getFile({ projectId: result.project.id, branch: "main" },
    result.project.settings.mainFileId);
  expect(file.path).toBe(mainPath);
  expect(file.editable).toBe(true);
  const patched = await fixture.service.patch(ids.kien, {
    projectId: result.project.id, expectedVersion: result.project.version, settings: result.project.settings,
  });
  expect(patched.settings.mainFileId).toBe(file.id);
});

test("native import publishes the explicitly selected main and compiler settings", async () => {
  // Given: an archive with two valid roots where discovery order is not the user's selection.
  await using fixture = await baseFixture();
  const entries = ["first.tex", "chosen.tex"].map(path => ({
    path, bytes: new TextEncoder().encode("\\documentclass{article}\n\\begin{document}Hello\\end{document}"),
  }));
  // When: the import chooses the second root and a specific compiler configuration.
  const project = await fixture.service.createFromFiles(ids.kien, {
    name: "Explicit import", entries, mainPath: "chosen.tex", engine: "xelatex", environmentId: ids.environment,
  });
  await fixture.restart();
  // Then: the first published project retains that choice across restart.
  expect((await fixture.service.getProject(project.id)).settings).toEqual(project.settings);
  expect(project.settings).toMatchObject({ engine: "xelatex", environmentId: ids.environment });
  expect((await fixture.service.getFile({ projectId: project.id, branch: "main" }, project.settings.mainFileId)).path)
    .toBe("chosen.tex");
});

test("native import rejects a missing explicit main instead of silently selecting another", async () => {
  // Given: a valid fallback root and an explicit nonexistent selection.
  await using fixture = await baseFixture();
  // When: the caller requests the nonexistent file.
  const error = await fixture.service.createFromFiles(ids.kien, {
    name: "Rejected import", mainPath: "missing.tex",
    entries: [{ path: "first.tex", bytes: new TextEncoder().encode("\\documentclass{article}\n") }],
  }).then(() => null, (failure: unknown) => failure);
  // Then: no project is published with substituted settings.
  expect(error).toMatchObject({ code: "INVALID_MAIN" });
  expect(await fixture.runtime.db.all("SELECT id FROM projects WHERE name=?", ["Rejected import"])).toHaveLength(0);
});
