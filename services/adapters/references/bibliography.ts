import { z } from "zod";
import { DigestSchema, FileEntrySchema, GitOidSchema, IdSchema, ScopeSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects } from "../../core/base";
import { parseBibtex } from "../../core/catalog/bibtex";
import type { AdapterServices, ActionContext, PreparedAction } from "../shared";
import { Zotero, ZoteroSelectionSchema } from "./zotero";
import type { BibliographyResult } from "./zotero";
import { Mendeley } from "./mendeley";
import type { PublicationRetrieval } from "./retrieval";
import { ReferenceSourceJournal } from "./source-journal";

export const BulkSchema = z.strictObject({
  scope: ScopeSchema, path: z.string().min(1).regex(/\.bib$/i),
  selection: ZoteroSelectionSchema.optional(),
}).readonly();
export const RefreshSchema = z.strictObject({ linkId: IdSchema, expectedDigest: DigestSchema, expectedVersion: z.number().int().positive() }).readonly();
export type BulkInput = z.infer<typeof BulkSchema>;
export class BibliographySync {
  readonly journal: ReferenceSourceJournal;
  constructor(readonly services: AdapterServices, readonly retrieval: PublicationRetrieval) {
    this.journal = new ReferenceSourceJournal(services);
  }
  async read(context: ActionContext, selection?: z.infer<typeof ZoteroSelectionSchema>): Promise<BibliographyResult> {
    let result: BibliographyResult;
    switch (context.grant.provider) {
      case "zotero":
        if (!selection) throw new ServiceError("ZOTERO_SELECTION_REQUIRED", 400, "Select Zotero users/groups library and optional collection");
        result = await new Zotero(this.retrieval.transport).read({
          baseUrl: context.configuration.baseUrl, apiKey: context.tokens.accessToken, selection, signal: context.signal });
        break;
      case "mendeley":
        result = await new Mendeley(this.retrieval.transport).read({
          baseUrl: context.configuration.baseUrl, accessToken: context.tokens.accessToken, signal: context.signal });
        break;
      default: throw new ServiceError("PROVIDER_UNCONFIGURED", 503, "Missing: ReadCube approved partner API endpoint, authentication/response contract and account permission");
    }
    if (result.publications.length) parseBibtex(result.publications.map(item => item.bibtex).join("\n"));
    for (const page of result.pages) await this.retrieval.retain(context.actorId, {
      ...page, nextCursor: null,
    });
    return result;
  }
  async bulk(input: BulkInput, context: ActionContext): Promise<PreparedAction> {
    if (input.scope.projectId !== context.projectId) throw new ServiceError("SCOPE_MISMATCH", 400, "Connection action and source project differ");
    return this.prepare({ input, context, result: await this.read(context, input.selection) });
  }
  async refresh(input: z.infer<typeof RefreshSchema>, context: ActionContext): Promise<PreparedAction> {
    const row = await this.services.context.db.get(`SELECT * FROM reference_links WHERE id=? AND grant_id=? AND owner_id=? AND project_id=?`,
      [input.linkId, context.grant.id, context.actorId, context.projectId ?? ""]);
    if (!row) throw new ServiceError("NOT_FOUND", 404, "Bibliography link not found");
    const link = z.object({ id: IdSchema, project_id: IdSchema, branch: z.string(), file_id: IdSchema,
      digest: DigestSchema, selection_json: z.string(), version: z.number().int() }).parse(row);
    if (link.version !== input.expectedVersion || link.digest !== input.expectedDigest) throw new ServiceError("REFERENCE_LINK_CONFLICT", 409, "Bibliography changed since last refresh");
    const selection = z.union([ZoteroSelectionSchema, z.null()]).parse(JSON.parse(link.selection_json));
    const service = new CoreProjects(this.services.context);
    const scope = { projectId: link.project_id, branch: link.branch };
    const file = await service.getFile(scope, link.file_id);
    if (file.blob !== input.expectedDigest || file.link?.sourceId !== link.id) {
      throw new ServiceError("REFERENCE_LINK_CONFLICT", 409, "Linked bytes or identity changed; current bytes were retained");
    }
    return this.prepare({ input: { scope, path: file.path, ...(selection ? { selection } : {}) }, context,
      result: await this.read(context, selection ?? undefined), previous: { id: link.id, fileId: file.id, version: link.version, digest: link.digest } });
  }
  private async prepare(request: {
    readonly input: BulkInput; readonly context: ActionContext; readonly result: BibliographyResult;
    readonly previous?: { readonly id: string; readonly fileId: string; readonly version: number; readonly digest: string };
  }): Promise<PreparedAction> {
    const { context: services } = this.services;
    const { input, context, result, previous } = request;
    const service = new CoreProjects(services);
    await service.authorize(context.actorId, input.scope, "owner");
    const current = await this.services.grants.credentials(context.actorId, context.grant.id);
    const configuration = await this.services.configuration.get(context.grant.provider);
    if (current.grant.version !== context.grant.version || configuration.version !== context.configuration.version || !configuration.enabled) {
      throw new ServiceError("PROVIDER_CHANGED", 409, "Connection or provider changed before bibliography preparation");
    }
    if (input.path.startsWith("/") || input.path.split("/").some(part => ["", ".", "..", ".git"].includes(part)) || input.path.includes("\0")) {
      throw new ServiceError("INVALID_PATH", 400, "Bibliography path must be a normalized project-relative path");
    }
    const lease = await services.branches.acquire(input.scope, crypto.randomUUID(), 60_000);
    if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "Bibliography branch busy");
    try {
      const files = await service.listFiles(input.scope);
      if (!previous && files.some(file => file.path === input.path)) throw new ServiceError("PATH_CONFLICT", 409, "Bibliography target exists; use explicit refresh");
      const existing = previous ? files.find(file => file.id === previous.fileId) : undefined;
      if (previous && (existing?.blob !== previous.digest || existing.link?.sourceId !== previous.id)) {
        throw new ServiceError("REFERENCE_LINK_CONFLICT", 409, "Bibliography changed while fetching; current bytes retained");
      }
      const id = IdSchema.parse(previous?.id ?? crypto.randomUUID());
      const file = FileEntrySchema.parse(existing ?? { id: crypto.randomUUID(), path: input.path, kind: "file",
        mime: "application/x-bibtex", blob: null, bytes: 0, editable: false, version: { revision: 0, epoch: 0 }, link: null });
      const linked = FileEntrySchema.parse({ ...file, editable: false,
        link: { kind: "bibliography", sourceId: id, lastRefreshedAt: services.clock.now() } });
      const bytes = new TextEncoder().encode(result.publications.map(item => item.bibtex).join("\n\n") + (result.publications.length ? "\n" : ""));
      const source = await service.prepareSource({ actorId: context.actorId, scope: input.scope, lease,
        expectedRevision: (await service.getBranch(input.scope)).revision,
        inputs: [...files.filter(item => item.id !== file.id).map(item => ({ file: item })), { file: linked, bytes }],
      });
      const digest = source.files.find(item => item.id === file.id)?.blob;
      if (!digest) throw new ServiceError("REFERENCE_SOURCE_INVALID", 500, "Prepared bibliography digest absent");
      const operation = z.object({ id: IdSchema }).parse(await services.db.get("SELECT id FROM operations WHERE actor_id=? AND idempotency_key=?",
        [context.actorId, context.key]));
      const payload = {
        source, link: { id, grantId: context.grant.id, ownerId: context.actorId, scope: input.scope,
          fileId: file.id, selection: JSON.stringify(input.selection ?? null), digest, cursor: result.cursor,
          expectedVersion: previous?.version ?? null },
        operationId: operation.id, action: previous ? "refresh" : "bulkBib", grantVersion: context.grant.version,
        configVersion: context.configuration.version, provider: context.grant.provider, expectedCursor: context.expectedCursor,
        result: { linkId: id, fileId: file.id, snapshotId: source.snapshot.id, digest, count: result.publications.length, version: (previous?.version ?? 0) + 1 },
      };
      const publicationId = IdSchema.parse(crypto.randomUUID());
      await this.journal.stage(publicationId, payload);
      await services.repositories.publish({ id: publicationId, lease, updates: [{
        ref: `refs/quire/history/${source.snapshot.id}`, expected: null, next: GitOidSchema.parse(`sha1:${source.commit}`),
      }] });
      return { result: payload.result, cursor: result.cursor,
        publish: tx => this.journal.finalize(tx, { id: publicationId, lease, payload }),
        release: () => services.branches.release(lease) };
    } catch (error) { await services.branches.release(lease); throw error; }
  }
}
