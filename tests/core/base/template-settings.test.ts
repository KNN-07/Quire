import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { migrateDatabase } from "@quire/runtime";
import { baseFixture, projectEnvelope } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";
import { migrations } from "../../../services/core/catalog";
import { seedStarterTemplate } from "../../../scripts/seed-template";

test("template creation publishes explicit compiler main and environment atomically", async () => {
  await using fixture = await baseFixture();
  await migrateDatabase(fixture.runtime.uow, migrations);
  await seedStarterTemplate(fixture.runtime);
  const actor = await fixture.login();
  const row = z.object({ id: IdSchema }).parse(await fixture.runtime.db.get("SELECT id FROM template_versions WHERE status='published'"));
  const input = { name: "Template explicit selection", origin: { kind: "template", templateVersionId: row.id },
    mainPath: "main.tex", engine: "xelatex", environmentId: fixtureIds.environment };
  const headers = { ...actor.headers, "idempotency-key": crypto.randomUUID() };
  const response = await fixture.request("/api/projects", { method: "POST", headers, body: JSON.stringify(input) });
  expect(response.status).toBe(200);
  const project = projectEnvelope.parse(await response.json()).data;
  expect(project.settings).toMatchObject({ engine: "xelatex", environmentId: fixtureIds.environment });
  expect((await fixture.service.getFile({ projectId: project.id, branch: project.defaultBranch }, project.settings.mainFileId)).path)
    .toBe("main.tex");
  await fixture.restart();
  const replay = await fixture.request("/api/projects", { method: "POST", headers, body: JSON.stringify(input) });
  expect(projectEnvelope.parse(await replay.json()).data).toEqual(project);
  const before = await fixture.runtime.db.all("SELECT id FROM repository_intents ORDER BY id");
  const rejected = await fixture.request("/api/projects", { method: "POST",
    headers: { ...actor.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ ...input, name: "Invalid template main", mainPath: "missing.tex" }),
  });
  expect(rejected.status).toBe(422);
  expect(await rejected.json()).toMatchObject({ error: { code: "INVALID_MAIN" } });
  expect(await fixture.runtime.db.all("SELECT id FROM projects WHERE name='Invalid template main'")).toHaveLength(0);
  expect(await fixture.runtime.db.all("SELECT id FROM repository_intents ORDER BY id")).toEqual(before);
});
