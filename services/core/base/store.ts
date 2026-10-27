import { z } from "zod";
import {
  IdSchema, ProjectSchema, FileEntrySchema, SnapshotSchema, UserSchema,
} from "@quire/contracts";
import type { Id, Scope, FileEntry, Project, Snapshot, User } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, SqlValue } from "@quire/runtime";

export const newId = (): Id => IdSchema.parse(crypto.randomUUID());
export function fail(code: string, status: number, message: string): never {
  throw new ServiceError(code, status, message);
}
export function compare(actual: number, expected: number): void {
  if (actual !== expected) fail("STALE_VERSION", 409, `Expected ${expected}, current ${actual}`);
}
export const branchRow = z.object({
  id: IdSchema, project_id: IdSchema, branch: z.string(), revision: z.number(), epoch: z.number(),
});
export class BaseStore {
  constructor(readonly context: ModuleContext) {}
  rows<T extends z.ZodType>(sql: string, values: readonly SqlValue[], schema: T): z.output<T>[] {
    return this.context.db.query(sql).all(...values).map((row) => schema.parse(row));
  }
  one<T extends z.ZodType>(sql: string, values: readonly SqlValue[], schema: T): z.output<T> {
    const row = this.context.db.query(sql).get(...values);
    if (!row) fail("NOT_FOUND", 404, "Resource not found");
    return schema.parse(row);
  }
  getProject(id: Id): Project {
    const row = this.one(`SELECT id,name,owner_id AS ownerId,workspace_id AS workspaceId,
      default_branch AS defaultBranch,settings_json,version,created_at AS createdAt,updated_at AS updatedAt
      FROM projects WHERE id=? AND deleted_at IS NULL`, [id], z.object({
      id: z.string(), name: z.string(), ownerId: z.string(), workspaceId: z.string().nullable(),
      defaultBranch: z.string(), settings_json: z.string(), version: z.number(),
      createdAt: z.string(), updatedAt: z.string(),
    }));
    const { settings_json, ...project } = row;
    return ProjectSchema.parse({ ...project, settings: JSON.parse(settings_json) });
  }
  getBranch(scope: Scope) {
    this.getProject(scope.projectId);
    return this.one("SELECT * FROM branch_workspaces WHERE project_id=? AND branch=?",
      [scope.projectId, scope.branch], branchRow);
  }
  listFiles(scope: Scope): readonly FileEntry[] {
    const branch = this.getBranch(scope);
    return this.context.db.query(`SELECT id,path,kind,mime,blob,bytes,editable,revision,epoch,link_json
      FROM files WHERE branch_id=? AND deleted_at IS NULL ORDER BY path,id`).all(branch.id).map(fileFromRow);
  }
  getFile(scope: Scope, id: Id): FileEntry {
    const file = this.listFiles(scope).find((entry) => entry.id === id);
    if (!file) fail("NOT_FOUND", 404, "File not found");
    return file;
  }
  getSnapshot(id: Id): Snapshot {
    const row = this.one(`SELECT id,project_id,branch,revision,tree,author_id,reason,created_at
      FROM snapshots WHERE id=?`, [id], z.object({
      id: IdSchema, project_id: IdSchema, branch: z.string(), revision: z.number(),
      tree: z.string(), author_id: IdSchema, reason: z.string(), created_at: z.string(),
    }));
    return SnapshotSchema.parse({
      id: row.id, scope: { projectId: row.project_id, branch: row.branch }, revision: row.revision,
      tree: row.tree, authorId: row.author_id, reason: row.reason, createdAt: row.created_at,
    });
  }
  readUser(id: Id): User {
    const row = this.one(`SELECT id,name,primary_email AS primaryEmail,managed_by AS managedBy,
      avatar_blob AS avatarBlob,latex_name AS latexName,affiliation,orcid,
      interface_language AS interfaceLanguage FROM users WHERE id=? AND deleted_at IS NULL AND suspended=0`,
    [id], z.object({
      id: IdSchema, name: z.string(), primaryEmail: z.string(), managedBy: z.string().nullable(),
      avatarBlob: z.string().nullable(), latexName: z.string(), affiliation: z.string(),
      orcid: z.string().nullable(), interfaceLanguage: z.string(),
    }));
    const emails = this.rows("SELECT email FROM verified_emails WHERE user_id=?", [id], z.object({ email: z.string() }));
    return UserSchema.parse({ ...row, verifiedEmails: emails.map((item) => item.email) });
  }
}
export function fileFromRow(value: unknown): FileEntry {
  const row = z.object({
    id: z.string(), path: z.string(), kind: z.string(), mime: z.string(),
    blob: z.string().nullable(), bytes: z.number(), editable: z.number(),
    revision: z.number(), epoch: z.number(), link_json: z.string().nullable(),
  }).parse(value);
  return FileEntrySchema.parse({
    id: row.id, path: row.path, kind: row.kind, mime: row.mime, blob: row.blob,
    bytes: row.bytes, editable: row.editable === 1, version: { revision: row.revision, epoch: row.epoch },
    link: row.link_json === null ? null : JSON.parse(row.link_json),
  });
}
