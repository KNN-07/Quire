import { z } from "zod";
import { IdSchema, PublicationSchema } from "@quire/contracts";
import type { Id, Publication, Transaction } from "@quire/contracts";
import { referenceBlob, ServiceError } from "@quire/runtime";
import type { AdapterServices } from "../shared";
import { Crossref } from "./crossref";
import type { RetrievalPage } from "./crossref";
import { Arxiv } from "./arxiv";
import { SemanticScholar } from "./semantic-scholar";
import { Mendeley } from "./mendeley";
import { ReferenceTransport } from "./transport";
import { ProvenanceSchema } from "./publication";
import type { RetrievedPublication } from "./publication";

export const RetrievalProviderSchema = z.enum(["crossref", "arxiv", "semanticScholar", "mendeley", "dimensions"]);
export type RetrievalProvider = z.infer<typeof RetrievalProviderSchema>;
export type SearchRequest = {
  readonly actorId: Id; readonly projectId: Id; readonly provider: RetrievalProvider;
  readonly query: string; readonly cursor?: string | null | undefined; readonly limit?: number | undefined;
  readonly signal?: AbortSignal | undefined;
};
export class PublicationRetrieval {
  readonly transport: ReferenceTransport;
  private readonly crossref: Crossref;
  private readonly arxiv: Arxiv;
  private readonly semantic: SemanticScholar;
  constructor(readonly services: AdapterServices) {
    this.transport = new ReferenceTransport(services.http, services.context.clock);
    this.crossref = new Crossref(this.transport);
    this.arxiv = new Arxiv(this.transport);
    this.semantic = new SemanticScholar(this.transport);
  }
  async configuration(provider: string) {
    const settings = await this.services.configuration.get(provider);
    if (provider === "dimensions") throw new ServiceError("PROVIDER_UNCONFIGURED", 503,
      "Missing: Dimensions institutional Analytics/CRIS API license permitting citation retrieval; tenant endpoint; licensed response/authentication contract; API credential");
    if (settings.version === 0 || !settings.baseUrl) {
      throw new ServiceError("PROVIDER_UNCONFIGURED", 503, `Missing: operator ${provider} base URL configuration`);
    }
    if (!settings.enabled) throw new ServiceError("PROVIDER_DISABLED", 503, `${provider} disabled by operator`);
    return settings;
  }
  async search(input: SearchRequest): Promise<{
    readonly items: readonly RetrievedPublication[]; readonly nextCursor: string | null;
  }> {
    const { context } = this.services;
    await this.services.grants.activeActor(input.actorId, context.db);
    const project = await context.db.get<{ default_branch: string }>("SELECT default_branch FROM projects WHERE id=?", [input.projectId]);
    if (!project) throw new ServiceError("NOT_FOUND", 404, "Project not found");
    await context.services.get("projects").authorize(input.actorId, { projectId: input.projectId, branch: project.default_branch }, "read");
    const settings = await this.configuration(input.provider);
    const request = { baseUrl: settings.baseUrl, query: z.string().trim().min(1).max(2000).parse(input.query),
      cursor: input.cursor ?? null, limit: z.number().int().min(1).max(100).parse(input.limit ?? 50),
      signal: input.signal ?? AbortSignal.timeout(30_000) };
    let result: RetrievalPage;
    switch (input.provider) {
      case "crossref": result = await this.crossref.search(request); break;
      case "arxiv": result = await this.arxiv.search(request); break;
      case "semanticScholar": result = await this.semantic.search({ ...request, apiKey: settings.secret }); break;
      case "mendeley": {
        const grants = await this.services.grants.list(input.actorId, { limit: 200 });
        const grant = grants.items.find(item => item.provider === "mendeley" && item.state === "ready");
        if (!grant) throw new ServiceError("PROVIDER_UNCONFIGURED", 503, "Missing: Mendeley registered application and account grant with all scope");
        const owned = await this.services.grants.credentials(input.actorId, grant.id);
        if (owned.tokens.expiresAt && owned.tokens.expiresAt <= context.clock.now()) throw new ServiceError("GRANT_EXPIRED", 409, "Refresh Mendeley grant");
        result = await new Mendeley(this.transport).page({ ...request, accessToken: owned.tokens.accessToken });
        break;
      }
      case "dimensions": throw new ServiceError("PROVIDER_UNCONFIGURED", 503, "Missing: licensed Dimensions response contract");
      default: { const unreachable: never = input.provider; throw new TypeError(String(unreachable)); }
    }
    const items = await this.retain(input.actorId, result);
    await this.configuration(input.provider);
    await context.services.get("projects").authorize(input.actorId, { projectId: input.projectId, branch: project.default_branch }, "read");
    return { items, nextCursor: result.nextCursor };
  }
  async lookup(actorId: Id, doi: string, provider: "doi" | "crossref" = "crossref"): Promise<RetrievedPublication> {
    await this.services.grants.activeActor(actorId, this.services.context.db);
    const settings = await this.configuration(provider);
    const page = await this.crossref.lookup({ baseUrl: settings.baseUrl, doi, signal: AbortSignal.timeout(30_000) });
    const item = (await this.retain(actorId, page))[0];
    if (!item) throw new ServiceError("PUBLICATION_NOT_FOUND", 404, "DOI record absent");
    return item;
  }
  async retain(actorId: Id, page: RetrievalPage): Promise<readonly RetrievedPublication[]> {
    const { context } = this.services;
    const responseDigest = await context.blobs.put(page.response.bytes);
    const items = page.publications.map(publication => ({ publication, provenance: ProvenanceSchema.parse({
      provider: publication.provider, providerId: publication.providerId, endpoint: page.response.endpoint,
      retrievedAt: context.clock.now(), responseDigest,
    }) }));
    await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await this.services.grants.activeActor(actorId, tx);
      await referenceBlob(tx, { digest: responseDigest, bytes: page.response.bytes.byteLength }, context.clock);
      for (const item of items) await this.save(tx, actorId, item);
    });
    return items;
  }
  private async save(tx: Transaction, actorId: Id, item: RetrievedPublication): Promise<void> {
    await tx.run(`INSERT INTO reference_provenance
      (owner_id,provider,provider_id,response_digest,endpoint,retrieved_at,publication_json) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(owner_id,provider,provider_id,response_digest) DO NOTHING`,
    [actorId, item.provenance.provider, item.provenance.providerId, item.provenance.responseDigest,
      item.provenance.endpoint, item.provenance.retrievedAt, JSON.stringify(item.publication)]);
  }
  async provenance(actorId: Id, publication: Publication): Promise<readonly RetrievedPublication[]> {
    await this.services.grants.activeActor(actorId, this.services.context.db);
    const rows = await this.services.context.db.all(`SELECT * FROM reference_provenance
      WHERE owner_id=? AND provider=? AND provider_id=? ORDER BY retrieved_at,response_digest`,
    [actorId, publication.provider, publication.providerId]);
    return rows.flatMap(row => {
      const parsed = z.object({ endpoint: z.string(), retrieved_at: z.string(), response_digest: z.string(),
        publication_json: z.string(), owner_id: IdSchema }).parse(row);
      const retained = PublicationSchema.parse(JSON.parse(parsed.publication_json));
      if (JSON.stringify(retained) !== JSON.stringify(PublicationSchema.parse(publication))) return [];
      return [{ publication: retained, provenance: ProvenanceSchema.parse({ provider: retained.provider, providerId: retained.providerId,
        endpoint: parsed.endpoint, retrievedAt: parsed.retrieved_at, responseDigest: parsed.response_digest }) }];
    });
  }
}
