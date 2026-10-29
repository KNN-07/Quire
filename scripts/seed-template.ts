import { z } from "zod";
import { ProjectSchema, TemplateVersionSchema } from "@quire/contracts";
import type { Runtime } from "@quire/runtime";
import { StorageError } from "@quire/runtime";
import { CoreProjects, exportSource } from "../services/core/base";
import { Templates } from "../services/core/catalog";
import { transition } from "../services/core/catalog/publication";
import { fixtureIds } from "../tests/fixtures/foundation";

const key = "quire:bundled-article:v1";
const actorId = fixtureIds.operator;

/** CLI-only initialization after application migrations, not part of foundation fixtures. */
export async function seedStarterTemplate(runtime: Runtime) {
  if (runtime.config.production || !["127.0.0.1", "localhost", "::1"].includes(runtime.config.host)) {
    throw new StorageError("LOCAL_SEED_ONLY", runtime.config.host);
  }
  // Never elevate a pre-existing account, including one occupying the seed operator ID.
  if (!await runtime.db.get(
    "SELECT id FROM users WHERE id=? AND operator=1 AND suspended=0 AND deleted_at IS NULL", [actorId],
  )) throw new StorageError("SEED_TEMPLATE_OPERATOR_REQUIRED", "The local seed operator must already be an active operator");
  const context = { ...runtime, routes: runtime.routes.forLane("K") };
  const projects = new CoreProjects(context);
  if (!runtime.services.has("projects")) runtime.services.provide("projects", projects);
  await projects.recover();
  const templates = new Templates(context);
  const receipt = (route: string, digest: string) => ({ actorId, key, route: `seed:${route}`, digest });
  async function prior(route: string) {
    return runtime.db.get<{ response_json: string }>(
      "SELECT response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?",
      [actorId, key, `seed:${route}`],
    );
  }
  const sourceReceipt = await prior("article-source");
  const source = sourceReceipt
    ? z.object({ data: ProjectSchema }).parse(JSON.parse(sourceReceipt.response_json)).data
    : await projects.createFromFiles(actorId, {
      name: "Quire bundled article source",
      entries: [{ path: "main.tex", bytes: await Bun.file(new URL("./templates/article/main.tex", import.meta.url)).bytes() }],
      http: receipt("article-source", key),
    });
  const templateReceipt = await prior("article-template");
  let version = templateReceipt
    ? z.object({ data: TemplateVersionSchema }).parse(JSON.parse(templateReceipt.response_json)).data
    : await templates.create(actorId, {
      name: "Starter Article", category: "Article",
      description: "A minimal original article with a title, abstract, and introduction.",
      license: "CC0-1.0", visibility: "public", sourceProjectId: source.id,
    }, receipt("article-template", key));
  // A completed seed is immutable initialization: never republish or rewrite managed content.
  const archive = await runtime.db.get<{ id: string }>(
    "SELECT id FROM operations WHERE actor_id=? AND idempotency_key=?", [actorId, key],
  );
  if (archive) return { templateId: version.templateId, versionId: version.id, archiveOperationId: archive.id };
  const template = await templates.template(version.templateId);
  version = await templates.version(template, version.id);
  for (const status of ["submitted", "approved", "published"] as const) {
    const preceding = { submitted: "draft", approved: "submitted", published: "approved" } as const;
    if (version.status === preceding[status]) version = await transition(templates, actorId, {
      id: version.templateId, versionId: version.id, expectedVersion: version.version, status,
    });
  }
  // The archive is an ordinary stored source-export operation, not a fabricated compile artifact.
  const exported = await exportSource(projects, actorId, {
    projectId: source.id, snapshotId: version.snapshotId, key,
  });
  return { templateId: version.templateId, versionId: version.id, archiveOperationId: exported.id };
}
