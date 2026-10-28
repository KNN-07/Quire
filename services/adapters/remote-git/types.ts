import { z } from "zod";
import { GitOidSchema, IdSchema } from "@quire/contracts";
import type { GitOid, Id } from "@quire/contracts";

export const RemoteProviderSchema = z.enum(["github", "gitlab", "git"]);
export type RemoteProvider = z.infer<typeof RemoteProviderSchema>;

export const RepositorySummarySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().min(1),
  defaultBranch: z.string().min(1),
  cloneUrl: z.url(),
  private: z.boolean(),
  updatedAt: z.string().nullable(),
}).readonly();
export type RepositorySummary = z.infer<typeof RepositorySummarySchema>;

export const BindingCursorSchema = z.strictObject({
  localHead: GitOidSchema,
  remoteHead: GitOidSchema,
  conflictBranch: z.string().min(1).optional(),
}).readonly();
export type BindingCursor = z.infer<typeof BindingCursorSchema>;

export const RemoteBindingSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  provider: RemoteProviderSchema,
  grantId: IdSchema,
  remoteUrl: z.url(),
  branch: z.string().min(1),
  cursor: BindingCursorSchema,
  version: z.number().int().nonnegative(),
}).readonly();
export type RemoteBinding = z.infer<typeof RemoteBindingSchema>;

export const BindingRowSchema = z.strictObject({
  id: IdSchema,
  project_id: IdSchema,
  provider: RemoteProviderSchema,
  grant_id: IdSchema,
  remote_url: z.string(),
  branch: z.string(),
  cursor: z.string().nullable(),
  version: z.number().int(),
}).readonly();

export function bindingFromRow(row: z.infer<typeof BindingRowSchema>): RemoteBinding {
  if (row.cursor === null) {
    throw new TypeError("Remote Git binding cursor is missing");
  }
  return RemoteBindingSchema.parse({
    id: row.id,
    projectId: row.project_id,
    provider: row.provider,
    grantId: row.grant_id,
    remoteUrl: row.remote_url,
    branch: row.branch,
    cursor: BindingCursorSchema.parse(JSON.parse(row.cursor)),
    version: row.version,
  });
}

export type RemoteRef = {
  readonly branch: string;
  readonly oid: GitOid;
};

export type PreparedRemotePublication = {
  readonly bindingId: Id;
  readonly cursor: BindingCursor;
  readonly result: Readonly<Record<string, unknown>>;
  readonly release: () => Promise<void>;
};
