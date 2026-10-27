import { z } from "zod";
import { IdSchema, assertNever } from "@quire/contracts";
import type { Id, Project, ProjectSummary, Page } from "@quire/contracts";
import type { CoreProjects } from "./projects";
import { fail } from "./store";

export function listProjects(service: CoreProjects, actorId: Id, query: {
  readonly owner: "me" | "shared" | "all"; readonly state: "active" | "archived" | "trash";
  readonly sort: "updated" | "title" | "owner"; readonly direction: "asc" | "desc";
  readonly q?: string | undefined; readonly tag?: Id | undefined; readonly cursor?: string | undefined; readonly limit: number;
}): Page<ProjectSummary> {
  const candidates = service.rows(`SELECT p.id,u.name AS owner FROM projects p JOIN users u ON u.id=p.owner_id
    LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=?
    LEFT JOIN project_user_state s ON s.project_id=p.id AND s.user_id=?
    WHERE p.deleted_at IS NULL AND (p.owner_id=? OR m.user_id=?)
    AND coalesce(s.state,'active')=?`, [actorId, actorId, actorId, actorId, query.state],
  z.object({ id: IdSchema, owner: z.string() }));
  const ownerNames = new Map(candidates.map((row) => [row.id, row.owner]));
  const projects = candidates.map((row) => service.getProject(row.id)).filter((project) => {
    if (query.owner === "me" && project.ownerId !== actorId) return false;
    if (query.owner === "shared" && project.ownerId === actorId) return false;
    if (query.q && !`${project.name} ${ownerNames.get(project.id) ?? ""}`.toLowerCase().includes(query.q.toLowerCase())) return false;
    if (query.tag && !service.context.db.query(`SELECT 1 FROM tag_assignments a JOIN tags t ON t.id=a.tag_id
      WHERE a.project_id=? AND a.tag_id=? AND t.user_id=?`).get(project.id, query.tag, actorId)) return false;
    return true;
  });
  const value = (project: Project) => {
    switch (query.sort) {
      case "title": return project.name.toLowerCase();
      case "owner": return ownerNames.get(project.id) ?? "";
      case "updated": return project.updatedAt;
      default: return assertNever(query.sort);
    }
  };
  projects.sort((a, b) => ((value(a).localeCompare(value(b)) || a.id.localeCompare(b.id)) * (query.direction === "asc" ? 1 : -1)));
  let start = 0;
  if (query.cursor) {
    const index = projects.findIndex((project) => project.id === query.cursor);
    if (index < 0) fail("INVALID_CURSOR", 400, "Cursor not in this result set");
    start = index + 1;
  }
  const items = projects.slice(start, start + query.limit).map((project) => ({
    ...project, ownerName: ownerNames.get(project.id) ?? "",
    role: service.role(actorId, project.id),
    tagIds: service.rows(`SELECT t.id FROM tags t JOIN tag_assignments a ON a.tag_id=t.id
      WHERE a.project_id=? AND t.user_id=? ORDER BY t.id`, [project.id, actorId], z.object({ id: IdSchema })).map((row) => row.id),
  }));
  return { items, nextCursor: start + query.limit < projects.length ? items.at(-1)?.id ?? null : null };
}
