import { z } from "zod";
import { endpoints, TagSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { CoreProjects } from "./projects";
import { actor, etag, replay, checkMatch } from "./http";
import { compare, fail, newId } from "./store";
import { saveHttp } from "./receipts";

export function registerTags(context: ModuleContext, service: CoreProjects): void {
  const get = async (actorId: Id, id: Id) => (await service.one(`SELECT id,name,color_hex AS "colorHex",version FROM tags WHERE id=? AND user_id=?`,
    [id, actorId], TagSchema));
  context.routes.register(endpoints.tagsList, async (input, request) => {
    const actorId = await actor(context, request);
    const rows = (await service.rows("SELECT id,name,color_hex AS \"colorHex\",version FROM tags WHERE user_id=? ORDER BY name,id",
      [actorId], TagSchema));
    const start = input.query.cursor ? rows.findIndex((tag) => tag.id === input.query.cursor) + 1 : 0;
    const items = rows.slice(start, start + input.query.limit);
    return { items, nextCursor: start + input.query.limit < rows.length ? items.at(-1)?.id ?? null : null };
  });
  context.routes.register(endpoints.tagGet, async (input, request) => {
    const tag = (await get(await actor(context, request), input.params.id)); etag(request, tag.version); return tag;
  });
  context.routes.register(endpoints.tagCreate, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: "tagCreate", body: input.body, schema: TagSchema }, async (http) => {
      const id = newId();
      if ((await context.db.get("SELECT 1 FROM tags WHERE user_id=? AND name=?", [actorId, input.body.name]))) {
        fail("TAG_EXISTS", 409, "Tag name already exists");
      }
      (await context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        const boundContext = { ...context, db: tx };
        if (await tx.get("SELECT 1 FROM tags WHERE user_id=? AND name=?", [actorId, input.body.name])) {
          fail("TAG_EXISTS", 409, "Tag name already exists");
        }
        await tx.run("INSERT INTO tags(id,user_id,name,color_hex,created_at) VALUES(?,?,?,?,?)",
          [id, actorId, input.body.name, input.body.colorHex.toUpperCase(), boundContext.clock.now()]);
        const tag = await service.withTransaction(tx).one(`SELECT id,name,color_hex AS "colorHex",version FROM tags WHERE id=?`, [id], TagSchema);
        await saveHttp(boundContext, http, tag, 0);
      }));
      etag(request, 0); return (await get(actorId, id));
    });
  });
  context.routes.register(endpoints.tagPatch, async (input, request) => {
    const actorId = await actor(context, request);
    const tag = (await get(actorId, input.params.id));
    compare(tag.version, input.body.expectedVersion);
    (await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      compare((await service.withTransaction(tx).one("SELECT version FROM tags WHERE id=?", [tag.id], z.object({ version: z.number() }))).version, input.body.expectedVersion);
      return (await tx.run("UPDATE tags SET name=?,color_hex=?,version=version+1 WHERE id=?", [input.body.name ?? tag.name, input.body.colorHex?.toUpperCase() ?? tag.colorHex, tag.id]));
    }));
    const result = (await get(actorId, tag.id)); etag(request, result.version); return result;
  });
  context.routes.register(endpoints.tagDelete, async (input, request) => {
    const tag = (await get(await actor(context, request), input.params.id));
    compare(tag.version, input.body.expectedVersion);
    (await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      compare((await service.withTransaction(tx).one("SELECT version FROM tags WHERE id=?", [tag.id], z.object({ version: z.number() }))).version, input.body.expectedVersion);
      return (await tx.run("DELETE FROM tags WHERE id=?", [tag.id]));
    }));
    return { ok: true as const, version: tag.version + 1 };
  });
  context.routes.register(endpoints.projectTags, async (input, request) => {
    const actorId = await actor(context, request);
    const project = (await service.getProject(input.params.p));
    await service.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "read");
    const version = (await service.getProject(project.id)).version;
    compare(version, input.body.expectedVersion); checkMatch(request, version);
    const tags = [...new Set(input.body.tagIds)];
    for (const id of tags) (await get(actorId, id));
    (await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      const boundContext = { ...context, db: tx };

      const bound = service.withTransaction(tx);
      await bound.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "read");
      compare((await bound.getProject(project.id)).version, input.body.expectedVersion);
      for (const id of tags) await bound.one("SELECT id,name,color_hex AS \"colorHex\",version FROM tags WHERE id=? AND user_id=?", [id, actorId], TagSchema);
      (await tx.run("DELETE FROM tag_assignments WHERE project_id=? AND tag_id IN (SELECT id FROM tags WHERE user_id=?)", [project.id, actorId]));
      for (const id of tags) (await tx.run("INSERT INTO tag_assignments(tag_id,project_id) VALUES(?,?)", [id, project.id]));
      (await tx.run(`INSERT INTO project_user_state(project_id,user_id,version,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(project_id,user_id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at`, [project.id, actorId, version + 1, boundContext.clock.now()]));
      (await tx.run("UPDATE projects SET version=version+1 WHERE id=?", [project.id]));

    }));
    request.responseHeaders.set("etag", `"v${version + 1}"`);
    return { ok: true as const, version: version + 1 };
  });
}
