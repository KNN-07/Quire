import { z } from "zod";
import { IdSchema, LibraryEntrySchema, TemplateVersionSchema } from "@quire/contracts";
import type { Id, LibraryEntry, TemplateVersion } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { CoreProjects } from "../base";

export const newId = (): Id => IdSchema.parse(crypto.randomUUID());
export function fail(code: string, status: number, message: string): never {
  throw new ServiceError(code, status, message);
}
export function compare(actual: number, expected: number): void {
  if (actual !== expected) fail("STALE_VERSION", 409, `Expected ${expected}, current ${actual}`);
}
export function projects(context: ModuleContext): CoreProjects {
  const port = context.services.get("projects");
  if (!(port instanceof CoreProjects)) fail("PROJECT_SOURCE_REQUIRED", 503, "Catalog requires the native source writer");
  return port;
}
export function libraryRow(value: unknown): LibraryEntry {
  const row = z.object({
    id: IdSchema, owner_id: IdSchema, citation_key: z.string(), bibtex: z.string(),
    origin: z.enum(["manual", "doi", "provider"]), provider_id: z.string().nullable(),
    readonly: z.number(), publication_json: z.string().nullable(), version: z.number(),
  }).parse(value);
  return LibraryEntrySchema.parse({ id: row.id, ownerId: row.owner_id, citationKey: row.citation_key,
    bibtex: row.bibtex, origin: row.origin, providerId: row.provider_id, readonly: row.readonly === 1,
    publication: row.publication_json ? JSON.parse(row.publication_json) : null, version: row.version });
}
export const templateRow = z.object({
  id: IdSchema, author_id: IdSchema, organization_id: IdSchema.nullable(), name: z.string(),
  category: z.string(), description: z.string(), license: z.string(),
  visibility: z.enum(["public", "organization", "private"]), version: z.number(),
  source_project_id: IdSchema.nullable(), current_version_id: IdSchema.nullable(),
  published_version_id: IdSchema.nullable(),
});
export type Template = z.infer<typeof templateRow>;
export function versionRow(value: unknown): TemplateVersion {
  const row = z.object({
    id: IdSchema, template_id: IdSchema, snapshot_id: IdSchema, name: z.string(),
    category: z.string(), description: z.string(), license: z.string(), visibility: z.string(),
    status: z.string(), organization_id: IdSchema.nullable(), version: z.number(),
  }).parse(value);
  return TemplateVersionSchema.parse({ id: row.id, templateId: row.template_id, snapshotId: row.snapshot_id,
    name: row.name, category: row.category, description: row.description, license: row.license,
    visibility: row.visibility, status: row.status, organizationId: row.organization_id, version: row.version });
}
export function page<T extends { readonly id: Id }>(items: readonly T[], query: {
  readonly limit: number; readonly cursor?: string | undefined;
}) {
  const start = query.cursor ? items.findIndex(item => item.id === query.cursor) + 1 : 0;
  if (query.cursor && start === 0) fail("INVALID_CURSOR", 400, "Cursor is not accessible");
  const selected = items.slice(start, start + query.limit);
  return { items: selected, nextCursor: start + selected.length < items.length ? selected.at(-1)?.id ?? null : null };
}
