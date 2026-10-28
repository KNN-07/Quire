import { FileEntrySchema, assertNever } from "@quire/contracts";
import type { Digest, Id, Scope } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { mutateFiles } from "../../core/base";
import type { CoreProjects, HttpReceipt, ExternalLinks } from "../../core/base";
import { emptyFile } from "../../core/base/files";
import type { SafeHttpClient } from "../shared";
import { fetchSource } from "./sources";

/** Public URL/Drive manual links. Provider OAuth and two-way sync are not implied. */
export class UrlLinks {
  constructor(private readonly projects: CoreProjects, private readonly http: SafeHttpClient) {}
  async create(input: {
    readonly actorId: Id; readonly scope: Scope; readonly path: string; readonly url: string;
    readonly expectedVersion: number; readonly http?: HttpReceipt;
  }) {
    await this.projects.authorize(input.actorId, input.scope, "files.write");
    const source = await fetchSource(this.http, input.url);
    const file = FileEntrySchema.parse({
      ...emptyFile(input.path, "file"), mime: source.mime,
      link: { kind: "url", sourceId: input.url, lastRefreshedAt: this.projects.context.clock.now() },
    });
    const files = await mutateFiles(this.projects, {
      actorId: input.actorId, scope: input.scope, expectedVersion: input.expectedVersion,
      ...(input.http ? { http: { ...input.http, result: { kind: "file", id: file.id } } } : {}),
    }, async entries => [...entries.map(entry => ({ file: entry })), { file, bytes: source.bytes }]);
    return FileEntrySchema.parse(files.find(entry => entry.id === file.id));
  }
  async refresh(input: {
    readonly actorId: Id; readonly scope: Scope; readonly fileId: Id;
    readonly expectedDigest: Digest; readonly expectedVersion: number; readonly http?: HttpReceipt;
  }) {
    await this.projects.authorize(input.actorId, input.scope, "files.write");
    const previous = await this.projects.getFile(input.scope, input.fileId);
    if (previous.link?.kind !== "url") throw new ServiceError("INVALID_LINK", 422, "File is not a manually refreshed URL link");
    if (previous.blob !== input.expectedDigest) throw new ServiceError("LINK_CONFLICT", 409, "Child digest changed; current bytes are preserved");
    const source = await fetchSource(this.http, previous.link.sourceId);
    const link = { ...previous.link, lastRefreshedAt: this.projects.context.clock.now() };
    const files = await mutateFiles(this.projects, {
      actorId: input.actorId, scope: input.scope, expectedVersion: input.expectedVersion,
      ...(input.http ? { http: { ...input.http, result: { kind: "file", id: previous.id } } } : {}),
    }, async entries => entries.map(file => {
      if (file.id !== previous.id) return { file };
      if (file.blob !== input.expectedDigest || file.link?.sourceId !== previous.link?.sourceId) {
        throw new ServiceError("LINK_CONFLICT", 409, "Child or source changed during refresh; current bytes are preserved");
      }
      return { file: FileEntrySchema.parse({ ...file, mime: source.mime, link }), bytes: source.bytes };
    }));
    return FileEntrySchema.parse(files.find(file => file.id === previous.id));
  }
}

export function composeExternalLinks(projects: CoreProjects, urls: UrlLinks, bibliography?: ExternalLinks): ExternalLinks {
  const requireBibliography = () => {
    if (!bibliography) throw new ServiceError("BIBLIOGRAPHY_LINKS_REQUIRED", 503,
      "Register the references contribution bibliographyLinks delegate with createInterchangeModule");
    return bibliography;
  };
  return {
    create(input) {
      switch (input.kind) {
        case "url":
          if (!input.url) throw new ServiceError("INVALID_LINK", 400, "URL link requires url");
          return urls.create({ ...input, url: input.url });
        case "bibliography": return requireBibliography().create(input);
        default: return assertNever(input.kind);
      }
    },
    async refresh(input) {
      const file = await projects.getFile(input.scope, input.fileId);
      if (!file.link) throw new ServiceError("INVALID_LINK", 422, "File is not linked");
      switch (file.link.kind) {
        case "url": return urls.refresh(input);
        case "bibliography": return requireBibliography().refresh(input);
        case "project": throw new ServiceError("INVALID_LINK", 422, "Core handles project links directly");
        default: return assertNever(file.link.kind);
      }
    },
  };
}
