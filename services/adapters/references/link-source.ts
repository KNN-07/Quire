import { DigestSchema } from "@quire/contracts";
import type { Digest, FileEntry, Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects } from "../../core/base";
import type { ExternalLinks, SourceFinalization } from "../../core/base";
import type { ActionContext, AdapterServices } from "../shared";
import type { GrantClaim } from "../shared/grants";
import type { BibliographyResult } from "./zotero";

type LinkBoundary = Pick<Parameters<ExternalLinks["create"]>[0], "actorId" | "scope" | "expectedVersion" | "http">;
export type LinkPublication = {
  readonly input: LinkBoundary; readonly context: ActionContext; readonly claim: GrantClaim;
  readonly file: FileEntry; readonly linkId: Id; readonly selection: string; readonly result: BibliographyResult;
  readonly previous?: { readonly version: number; readonly digest: Digest };
};

/** Core owns the source/Git journal, HTTP receipt and transaction for these routes. */
export async function publishBibliographyLink(services: AdapterServices, request: LinkPublication): Promise<FileEntry> {
  const { context, input, claim, result, previous } = request;
  const projects = new CoreProjects(services.context);
  const current = await services.grants.credentials(input.actorId, context.grant.id);
  await services.context.uow.run(tx => services.grants.assert(claim, tx));
  const settings = await services.configuration.get(context.grant.provider);
  if (current.grant.version !== context.grant.version || settings.version !== context.configuration.version || !settings.enabled) {
    throw new ServiceError("PROVIDER_CHANGED", 409, "Bibliography connection or configuration changed during retrieval");
  }
  const bytes = new TextEncoder().encode(result.publications.map(item => item.bibtex).join("\n\n") + (result.publications.length ? "\n" : ""));
  const digest = DigestSchema.parse(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
  const statement = (sql: string, parameters: SourceFinalization["statements"][number]["parameters"]) =>
    ({ sqlite: sql, postgres: sql, parameters, changes: 1 });
  return projects.serialized(input.scope, async lease => {
    await projects.authorize(input.actorId, input.scope, "owner");
    const files = await projects.listFiles(input.scope);
    const existing = files.find(file => file.id === request.file.id);
    if (previous) {
      if (existing?.blob !== previous.digest || existing.link?.kind !== "bibliography" || existing.link.sourceId !== request.linkId) {
        throw new ServiceError("LINK_CONFLICT", 409, "Bibliography identity or child bytes changed; current bytes retained");
      }
    } else if (files.some(file => file.path === request.file.path)) {
      throw new ServiceError("PATH_CONFLICT", 409, "Bibliography target exists; use explicit refresh");
    }
    const finalization: SourceFinalization = {
      statements: [
        statement("UPDATE provider_grants SET version=version WHERE id=? AND owner_id=? AND version=? AND state='ready'",
          [context.grant.id, input.actorId, context.grant.version]),
        statement("UPDATE adapter_provider_configs SET version=version WHERE kind=? AND version=? AND enabled=1",
          [context.grant.provider, context.configuration.version]),
        statement("UPDATE projects SET version=version WHERE id=? AND owner_id=? AND deleted_at IS NULL", [input.scope.projectId, input.actorId]),
        previous ? statement(`UPDATE reference_links SET digest=?,cursor=?,version=version+1
          WHERE id=? AND grant_id=? AND owner_id=? AND project_id=? AND branch=? AND file_id=? AND version=? AND digest=?`,
        [digest, result.cursor, request.linkId, context.grant.id, input.actorId, input.scope.projectId, input.scope.branch,
          request.file.id, previous.version, previous.digest])
          : statement(`INSERT INTO reference_links
            (id,grant_id,owner_id,project_id,branch,file_id,selection_json,digest,cursor,version) VALUES(?,?,?,?,?,?,?,?,?,1)`,
          [request.linkId, context.grant.id, input.actorId, input.scope.projectId, input.scope.branch, request.file.id,
            request.selection, digest, result.cursor]),
      ],
      receipts: [], events: [],
    };
    await projects.commitSource({
      actorId: input.actorId, scope: input.scope, lease, expectedRevision: input.expectedVersion, finalization,
      ...(input.http ? { http: { ...input.http, result: { kind: "file", id: request.file.id } } } : {}),
      inputs: [...files.filter(file => file.id !== request.file.id).map(file => ({ file })), { file: request.file, bytes }],
    });
    return projects.getFile(input.scope, request.file.id);
  });
}
