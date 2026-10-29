import { z } from "zod";
import { IdSchema, assertNever } from "@quire/contracts";
import type { Id, Project, ProjectSummary, Page } from "@quire/contracts";
import type { CoreProjects } from "./projects";
import { fail } from "./store";

export async function listProjects(service: CoreProjects, actorId: Id, query: {
  readonly owner: "me" | "shared" | "all"; readonly state: "active" | "archived" | "trash";
  readonly sort: "updated" | "title" | "owner"; readonly direction: "asc" | "desc";
  readonly q?: string | undefined; readonly tag?: Id | undefined; readonly cursor?: string | undefined; readonly limit: number;
  readonly workspace?: "all" | "personal" | Id | undefined;
}): Promise<Page<ProjectSummary>> {
  const workspace = query.workspace ?? "all";
  if (workspace !== "all" && workspace !== "personal"
    && !await service.context.db.get("SELECT 1 FROM members WHERE organization_id=? AND user_id=?", [workspace, actorId])) {
    fail("NOT_FOUND", 404, "Workspace not found");
  }
  const candidates = (await service.rows(`SELECT p.id,u.name AS owner FROM projects p JOIN users u ON u.id=p.owner_id
    LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=?
    LEFT JOIN project_user_state s ON s.project_id=p.id AND s.user_id=?
    WHERE p.deleted_at IS NULL AND (p.owner_id=? OR m.user_id=?)
    AND coalesce(s.state,'active')=?
    AND (?='all' OR (?='personal' AND p.workspace_id IS NULL) OR p.workspace_id=?)`,
    [actorId, actorId, actorId, actorId, query.state, workspace, workspace, workspace],
    z.object({ id: IdSchema, owner: z.string() })));
  const ownerNames = new Map(candidates.map((row) => [row.id, row.owner]));
  const projects: Project[] = [];
  for (const row of candidates) {
    const project = await service.getProject(row.id);
    if (query.owner === "me" && project.ownerId !== actorId) continue;
    if (query.owner === "shared" && project.ownerId === actorId) continue;
    if (query.q && !`${project.name} ${ownerNames.get(project.id) ?? ""}`.toLowerCase().includes(query.q.toLowerCase())) continue;
    if (query.tag && !(await service.context.db.get(`SELECT 1 FROM tag_assignments a JOIN tags t ON t.id=a.tag_id
      WHERE a.project_id=? AND a.tag_id=? AND t.user_id=?`, [project.id, query.tag, actorId]))) continue;
    // Revoked link memberships must not contribute rows or pagination cursors.
    try { await service.role(actorId, project.id); }
    catch (error) {
      if (error instanceof Error && "code" in error && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) continue;
      throw error;
    }
    projects.push(project);
  }
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
  const items = (await Promise.all(projects.slice(start, start + query.limit).map(async (project) => ({
    ...project, ownerName: ownerNames.get(project.id) ?? "",
    role: (await service.role(actorId, project.id)),
    tagIds: (await service.rows(`SELECT t.id FROM tags t JOIN tag_assignments a ON a.tag_id=t.id
      WHERE a.project_id=? AND t.user_id=? ORDER BY t.id`, [project.id, actorId], z.object({ id: IdSchema }))).map((row) => row.id),
  }))));
  return { items, nextCursor: start + query.limit < projects.length ? items.at(-1)?.id ?? null : null };
}

export async function listWorkspaces(service: CoreProjects, actorId: Id, query: {
  readonly cursor?: string | undefined; readonly limit: number;
}) {
  if (query.cursor && !await service.context.db.get(
    "SELECT 1 FROM members WHERE organization_id=? AND user_id=?", [query.cursor, actorId])) {
    fail("INVALID_CURSOR", 400, "Cursor not in this result set");
  }
  const rows = await service.rows(`SELECT o.id,o.name,o.kind FROM organizations o
    JOIN members m ON m.organization_id=o.id AND m.user_id=?
    WHERE o.id>? ORDER BY o.id LIMIT ?`, [actorId, query.cursor ?? "", query.limit + 1],
  z.object({ id: IdSchema, name: z.string(), kind: z.enum(["team", "institution"]) }));
  const items = rows.slice(0, query.limit);
  return { items, nextCursor: rows.length > query.limit ? items.at(-1)?.id ?? null : null };
}
