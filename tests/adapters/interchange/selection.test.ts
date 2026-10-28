import { test, expect } from "bun:test";
import { z } from "zod";
import { zipSync } from "fflate";
import { IdSchema, OperationSchema, EnvironmentSchema } from "@quire/contracts";
import { interchangeFixture } from "./harness";

test("selects the requested TeX main and engine before native ZIP publication", async () => {
  // Given
  await using fixture = await interchangeFixture();
  const owner = await fixture.login();
  const bytes = zipSync({
    "first.tex": new TextEncoder().encode("\\documentclass{article}\\begin{document}First\\end{document}"),
    "selected.tex": new TextEncoder().encode("\\documentclass{article}\\begin{document}Selected\\end{document}"),
  });
  const installed = z.object({ id: IdSchema, manifest_json: z.string() }).parse(
    await fixture.runtime.db.get("SELECT id,manifest_json FROM environments WHERE retired_at IS NULL LIMIT 1"));
  await fixture.runtime.db.run("UPDATE environments SET is_default=1 WHERE id=?", [installed.id]);
  // The alternate profile refers to the same installed immutable toolchain, not a fabricated installation.
  const current = EnvironmentSchema.parse(JSON.parse(installed.manifest_json));
  const environment = EnvironmentSchema.parse({ ...current,
    id: crypto.randomUUID(), label: "Explicit profile alias" });
  await fixture.runtime.db.run(`INSERT INTO environments
    (id,label,release,backend,manifest_json,available,is_default,probe_at,created_at) VALUES(?,?,?,?,?,?,0,?,?)`,
  [environment.id, environment.label, environment.release, environment.backend, JSON.stringify(environment),
    Number(environment.available), environment.probeAt, fixture.runtime.clock.now()]);
  const form = new FormData();
  form.set("kind", "zip"); form.set("name", "Explicit selection"); form.set("source", new File([bytes], "project.zip"));
  form.set("mainPath", "selected.tex"); form.set("engine", "xelatex"); form.set("environmentId", environment.id);
  // When
  const response = await fixture.request("/api/imports", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": "select-import-main" }, body: form });
  // Then
  expect(response.status).toBe(202);
  const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
  const [id] = z.object({ projectIds: z.array(IdSchema) }).parse(operation.result).projectIds;
  if (!id) throw new TypeError("Project required");
  const project = await fixture.service.getProject(id);
  const main = await fixture.service.getFile({ projectId: id, branch: "main" }, project.settings.mainFileId);
  expect(main.path).toBe("selected.tex");
  expect(project.settings.engine).toBe("xelatex");
  expect(project.settings.environmentId).toBe(environment.id);
  expect(project.settings.environmentId).not.toBe(installed.id);
});
