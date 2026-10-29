import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { IdSchema, PreferencesSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { migrateDatabase } from "@quire/runtime";
import { baseFixture, projectEnvelope } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";
import { migrations as catalogMigrations } from "../../../services/core/catalog";
import { seedStarterTemplate } from "../../../scripts/seed-template";

async function savedEngine(app: Awaited<ReturnType<typeof baseFixture>>, actor: Id, engine: "xelatex" | "lualatex" | "plain") {
  const row = await app.runtime.db.get<{ value_json: string }>("SELECT value_json FROM preferences WHERE user_id=?", [actor]);
  if (!row) throw new Error("Seeded actor preference required");
  const preferences = PreferencesSchema.parse({ ...JSON.parse(row.value_json), defaultEngine: engine });
  await app.runtime.db.run("UPDATE preferences SET value_json=? WHERE user_id=?", [JSON.stringify(preferences), actor]);
}

test("ordinary creation uses only its actor's saved engine and persists explicit overrides", async () => {
  await using app = await baseFixture();
  await savedEngine(app, fixtureIds.kien, "xelatex");
  await savedEngine(app, fixtureIds.mai, "lualatex");
  const owner = await app.service.create(fixtureIds.kien, { name: "Saved XeLaTeX", origin: { kind: "blank" } });
  const other = await app.service.create(fixtureIds.mai, { name: "Saved LuaLaTeX", origin: { kind: "example" } });
  const explicit = await app.service.create(fixtureIds.kien, {
    name: "Explicit pdfLaTeX", origin: { kind: "blank" }, engine: "pdflatex", environmentId: fixtureIds.environment,
  });
  expect(owner.settings.engine).toBe("xelatex");
  expect(other.settings.engine).toBe("lualatex");
  expect(explicit.settings.engine).toBe("pdflatex");
  await app.restart();
  expect((await app.service.getProject(owner.id)).settings).toEqual(owner.settings);
  expect((await app.service.getProject(other.id)).settings).toEqual(other.settings);
  expect((await app.service.getProject(explicit.id)).settings).toEqual(explicit.settings);
});

test("HTTP creation without an explicit engine uses the saved default once across request replay", async () => {
  await using app = await baseFixture();
  const actor = await app.login();
  await savedEngine(app, actor.user.id, "xelatex");
  const key = crypto.randomUUID();
  const request = {
    method: "POST", headers: { ...actor.headers, "idempotency-key": key },
    body: JSON.stringify({ name: "Default boundary", origin: { kind: "blank" } }),
  };
  const response = await app.request("/api/projects", request);
  expect(response.status).toBe(200);
  const project = projectEnvelope.parse(await response.json()).data;
  expect(project.settings.engine).toBe("xelatex");
  await savedEngine(app, actor.user.id, "lualatex");
  const replay = await app.request("/api/projects", request);
  expect(replay.status).toBe(200);
  expect(projectEnvelope.parse(await replay.json()).data).toEqual(project);
  expect(await app.runtime.db.all("SELECT id FROM projects WHERE name=?", ["Default boundary"])).toHaveLength(1);
  console.info("P61_HTTP_DEFAULT_REPLAY", { utc: new Date().toISOString(), url: new URL("/api/projects", response.url).href,
    status: response.status, replayStatus: replay.status, actorId: actor.user.id, projectId: project.id, key, settings: project.settings });
});

test("template and imported source retain their creation settings instead of inheriting actor defaults", async () => {
  await using app = await baseFixture();
  await migrateDatabase(app.runtime.uow, catalogMigrations);
  await seedStarterTemplate(app.runtime);
  await savedEngine(app, fixtureIds.kien, "lualatex");
  const version = await app.runtime.db.get<{ id: string }>("SELECT id FROM template_versions WHERE status='published'");
  if (!version) throw new Error("Published bundled template required");
  const template = await app.service.create(fixtureIds.kien, {
    name: "Template", origin: { kind: "template", templateVersionId: IdSchema.parse(version.id) },
  });
  const entries = [{ path: "main.tex", bytes: new TextEncoder().encode("\\documentclass{article}\n\\begin{document}Import\\end{document}\n") }];
  const imported = await app.service.createFromFiles(fixtureIds.kien, {
    name: "Declared import", entries, engine: "xelatex", environmentId: fixtureIds.environment,
  });
  const unspecified = await app.service.createFromFiles(fixtureIds.kien, { name: "Legacy import", entries });
  expect(template.settings.engine).toBe("pdflatex");
  expect(imported.settings.engine).toBe("xelatex");
  expect(unspecified.settings.engine).toBe("pdflatex");
});

test("incompatible saved compiler and invalid workspace deny creation before repository publication", async () => {
  await using app = await baseFixture();
  const before = await app.runtime.db.all("SELECT id FROM repository_intents ORDER BY id");
  const projects = await app.runtime.db.all("SELECT id FROM projects ORDER BY id");
  await savedEngine(app, fixtureIds.kien, "plain");
  await rejects(app.service.create(fixtureIds.kien, { name: "Invalid plain seed", origin: { kind: "blank" } }), { code: "INVALID_MAIN" });
  await rejects(app.service.createFromFiles(fixtureIds.kien, {
    name: "Unsupported engine", engine: "plain", environmentId: fixtureIds.environment,
    entries: [{ path: "main.tex", bytes: new TextEncoder().encode("Hello\\bye\n") }],
  }), { code: "ENGINE_UNAVAILABLE" });
  await rejects(app.service.create(fixtureIds.outsider, {
    name: "Unauthorized workspace", workspaceId: fixtureIds.team, engine: "pdflatex", origin: { kind: "blank" },
  }), { code: "FORBIDDEN" });
  expect(await app.runtime.db.all("SELECT id FROM repository_intents ORDER BY id")).toEqual(before);
  expect(await app.runtime.db.all("SELECT id FROM projects ORDER BY id")).toEqual(projects);
});
