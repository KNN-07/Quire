import { z } from "zod";
import { FileEntrySchema, IdSchema, assertNever } from "@quire/contracts";
import type { Id, Scope } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects, emptyFile } from "../../core/base";
import type { ExternalLinks } from "../../core/base";
import { configurationCapability } from "../shared";
import type { ActionContext, AdapterServices } from "../shared";
import type { GrantClaim } from "../shared/grants";
import { bibliographyDefinition } from "./providers";
import type { BibliographySync } from "./bibliography";
import { Zotero, ZoteroSelectionSchema } from "./zotero";
import type { ZoteroSelection } from "./zotero";
import { publishBibliographyLink } from "./link-source";
import { providerUrl } from "./transport";

/** A contribution to interchange's single dispatcher; never a registered second adapter. */
export class BibliographyLinks implements ExternalLinks {
  constructor(readonly services: AdapterServices, readonly bibliography: BibliographySync) {}
  private async withGrant<T>(input: { readonly actorId: Id; readonly scope: Scope; readonly grantId: Id },
    work: (context: ActionContext, claim: GrantClaim) => Promise<T>): Promise<T> {
    const projects = new CoreProjects(this.services.context);
    await projects.authorize(input.actorId, input.scope, "owner");
    await projects.policy(input.actorId, input.scope.projectId);
    const owned = await this.services.grants.credentials(input.actorId, input.grantId);
    const kind = z.enum(["zotero", "mendeley", "readcube"]).safeParse(owned.grant.provider);
    if (!kind.success) throw new ServiceError("GRANT_PROVIDER_MISMATCH", 400, "Bibliography links require Zotero, Mendeley or ReadCube grant");
    const configuration = await this.services.configuration.get(kind.data);
    const definition = bibliographyDefinition({ kind: kind.data, services: this.services,
      bibliography: this.bibliography, retrieval: this.bibliography.retrieval });
    const capability = configurationCapability(definition, configuration);
    if (!capability.enabled) throw new ServiceError("PROVIDER_UNCONFIGURED", 503, capability.reason ?? "Bibliography provider unavailable");
    if (owned.tokens.expiresAt && owned.tokens.expiresAt <= this.services.context.clock.now()) {
      throw new ServiceError("GRANT_EXPIRED", 409, "Refresh or reconnect the bibliography grant");
    }
    const claim = await this.services.grants.claim({ actorId: input.actorId, grantId: input.grantId, expectedVersion: owned.grant.version });
    try {
      return await work({ actorId: input.actorId, ...owned, configuration, projectId: input.scope.projectId,
        expectedCursor: null, key: crypto.randomUUID(), signal: AbortSignal.timeout(120_000) }, claim);
    } finally { await this.services.grants.release(claim); }
  }
  private async selection(context: ActionContext, url?: string): Promise<ZoteroSelection | undefined> {
    if (!url) {
      if (context.grant.provider !== "zotero") return undefined;
      const key = await new Zotero(this.bibliography.retrieval.transport).key({
        baseUrl: context.configuration.baseUrl, apiKey: context.tokens.accessToken, signal: context.signal });
      if (!key.access.user?.library) throw new ServiceError("ZOTERO_SELECTION_REQUIRED", 400, "Group-only key requires an explicit configured Zotero library URL");
      return { libraryType: "users", libraryId: String(key.userID) };
    }
    const target = new URL(url);
    const base = new URL(context.configuration.baseUrl);
    if (target.origin !== base.origin || target.username || target.password || target.search || target.hash) {
      throw new ServiceError("INVALID_BIBLIOGRAPHY_URL", 400, "Bibliography selection must use the configured provider origin without credentials, query or fragment");
    }
    if (context.grant.provider === "mendeley") {
      if (target.href !== providerUrl(context.configuration.baseUrl, "documents").href) {
        throw new ServiceError("INVALID_BIBLIOGRAPHY_URL", 400, "Mendeley selection must be the configured account documents endpoint");
      }
      return undefined;
    }
    const prefix = base.pathname.replace(/\/+$/, "");
    const match = /^\/(users|groups)\/(\d+)(?:\/collections\/([A-Z0-9]{8}))?(?:\/items(?:\/top)?)?\/?$/.exec(target.pathname.slice(prefix.length));
    if (!target.pathname.startsWith(`${prefix}/`) || !match) throw new ServiceError("INVALID_BIBLIOGRAPHY_URL", 400, "Expected configured Zotero users/groups library or collection URL");
    return ZoteroSelectionSchema.parse({ libraryType: match[1], libraryId: match[2],
      ...(match[3] ? { collectionKey: match[3] } : {}) });
  }
  async create(input: Parameters<ExternalLinks["create"]>[0]) {
    switch (input.kind) {
      case "bibliography": break;
      case "url": throw new ServiceError("INVALID_LINK", 400, "URL links belong to the interchange dispatcher");
      default: return assertNever(input.kind);
    }
    if (!input.grantId || !/\.bib$/i.test(input.path)) {
      throw new ServiceError("INVALID_LINK", 400, "Bibliography links require kind bibliography, an owned grant and a .bib target");
    }
    return this.withGrant({ actorId: input.actorId, scope: input.scope, grantId: input.grantId }, async (context, claim) => {
      const selection = await this.selection(context, input.url);
      const result = await this.bibliography.read(context, selection);
      const linkId = IdSchema.parse(crypto.randomUUID());
      const file = FileEntrySchema.parse({ ...emptyFile(input.path, "file"), mime: "application/x-bibtex",
        link: { kind: "bibliography", sourceId: linkId, lastRefreshedAt: this.services.context.clock.now() } });
      return publishBibliographyLink(this.services, { input, context, claim, file, linkId,
        selection: JSON.stringify(selection ?? null), result });
    });
  }
  async refresh(input: Parameters<ExternalLinks["refresh"]>[0]) {
    const projects = new CoreProjects(this.services.context);
    await projects.authorize(input.actorId, input.scope, "owner");
    const file = await projects.getFile(input.scope, input.fileId);
    if (file.link?.kind !== "bibliography" || file.blob !== input.expectedDigest) {
      throw new ServiceError("LINK_CONFLICT", 409, "Bibliography identity or expected child digest differs");
    }
    const row = await this.services.context.db.get(`SELECT id,grant_id,selection_json,version FROM reference_links
      WHERE id=? AND owner_id=? AND project_id=? AND branch=? AND file_id=? AND digest=?`,
    [file.link.sourceId, input.actorId, input.scope.projectId, input.scope.branch, input.fileId, input.expectedDigest]);
    if (!row) throw new ServiceError("NOT_FOUND", 404, "Owned bibliography link not found");
    const link = z.object({ id: IdSchema, grant_id: IdSchema, selection_json: z.string(), version: z.number().int().positive() }).parse(row);
    return this.withGrant({ actorId: input.actorId, scope: input.scope, grantId: link.grant_id }, async (context, claim) => {
      const selection = z.union([ZoteroSelectionSchema, z.null()]).parse(JSON.parse(link.selection_json));
      const result = await this.bibliography.read(context, selection ?? undefined);
      const updated = FileEntrySchema.parse({ ...file,
        link: { kind: "bibliography", sourceId: link.id, lastRefreshedAt: this.services.context.clock.now() } });
      return publishBibliographyLink(this.services, { input, context, claim, file: updated, linkId: link.id,
        selection: link.selection_json, result, previous: { version: link.version, digest: input.expectedDigest } });
    });
  }
}
