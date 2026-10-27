import { endpoints, TagSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { CoreProjects } from "./projects";
import { actor, etag, replay, checkMatch } from "./http";
import { compare, fail, newId } from "./store";

export function registerTags(context: ModuleContext, service: CoreProjects): void {
  const get = (actorId: Id, id: Id) => service.one(`SELECT id,name,color_hex AS colorHex,version FROM tags WHERE id=? AND user_id=?`,
    [id, actorId], TagSchema);
  context.routes.register(endpoints.tagsList, async (input, request) => {
    const actorId = await actor(context, request);
    const rows = service.rows("SELECT id,name,color_hex AS colorHex,version FROM tags WHERE user_id=? ORDER BY name,id",
      [actorId], TagSchema);
    const start = input.query.cursor ? rows.findIndex((tag) => tag.id === input.query.cursor) + 1 : 0;
    const items = rows.slice(start, start + input.query.limit);
    return { items, nextCursor: start + input.query.limit < rows.length ? items.at(-1)?.id ?? null : null };
  });
  context.routes.register(endpoints.tagGet, async (input, request) => {
    const tag = get(await actor(context, request), input.params.id); etag(request, tag.version); return tag;
  });
  context.routes.register(endpoints.tagCreate, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: "tagCreate", body: input.body, schema: TagSchema }, async () => {
      const id = newId();
      if (context.db.query("SELECT 1 FROM tags WHERE user_id=? AND name=?").get(actorId, input.body.name)) {
        fail("TAG_EXISTS", 409, "Tag name already exists");
      }
      context.uow.local((tx) => tx.query("INSERT INTO tags(id,user_id,name,color_hex,created_at) VALUES(?,?,?,?,?)")
        .run(id, actorId, input.body.name, input.body.colorHex.toUpperCase(), context.clock.now()));
      etag(request, 0); return get(actorId, id);
    });
  });
  context.routes.register(endpoints.tagPatch, async (input, request) => {
    const actorId = await actor(context, request);
    const tag = get(actorId, input.params.id);
    compare(tag.version, input.body.expectedVersion);
    context.uow.local((tx) => tx.query("UPDATE tags SET name=?,color_hex=?,version=version+1 WHERE id=?")
      .run(input.body.name ?? tag.name, input.body.colorHex?.toUpperCase() ?? tag.colorHex, tag.id));
    const result = get(actorId, tag.id); etag(request, result.version); return result;
  });
  context.routes.register(endpoints.tagDelete, async (input, request) => {
    const tag = get(await actor(context, request), input.params.id);
    compare(tag.version, input.body.expectedVersion);
    context.uow.local((tx) => tx.query("DELETE FROM tags WHERE id=?").run(tag.id));
    return { ok: true as const, version: tag.version + 1 };
  });
  context.routes.register(endpoints.projectTags, async (input, request) => {
    const actorId = await actor(context, request);
    const project = service.getProject(input.params.p);
    await service.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "read");
    const version = service.getProject(project.id).version;
    compare(version, input.body.expectedVersion); checkMatch(request, version);
    const tags = [...new Set(input.body.tagIds)];
    for (const id of tags) get(actorId, id);
    context.uow.local((tx) => {
      tx.query("DELETE FROM tag_assignments WHERE project_id=? AND tag_id IN (SELECT id FROM tags WHERE user_id=?)").run(project.id, actorId);
      for (const id of tags) tx.query("INSERT INTO tag_assignments(tag_id,project_id) VALUES(?,?)").run(id, project.id);
      tx.query(`INSERT INTO project_user_state(project_id,user_id,version,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(project_id,user_id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at`)
        .run(project.id, actorId, version + 1, context.clock.now());
      tx.query("UPDATE projects SET version=version+1 WHERE id=?").run(project.id);
    });
    request.responseHeaders.set("etag", `"v${version + 1}"`);
    return { ok: true as const, version: version + 1 };
  });
}
