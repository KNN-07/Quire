import { z } from "zod";
import { assertNever, IdSchema, ProjectSchema } from "@quire/contracts";
import type { Id, Operation, Project, CompileSettings } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { readZip } from "../../core/base";
import type { CoreProjects, NativeFile, HttpReceipt } from "../../core/base";
import { recordOperation } from "../../core/base/operations";
import { decodeText } from "../../core/base/limits";
import type { SafeHttpClient } from "../shared";
import type { ImportSource } from "./sources";
import { resolveSource } from "./sources";
import type { PandocConverter } from "./converter";
import type { ImportUploads } from "./uploads";

export type NativeImport = {
  readonly kind: "zip" | "docx" | "markdown" | "open-in";
  readonly name: string; readonly workspaceId?: Id; readonly source: ImportSource;
  readonly mainPath?: string; readonly engine?: CompileSettings["engine"]; readonly environmentId?: Id;
};
export type RemoteImport = {
  readonly kind: "git" | "github"; readonly name: string; readonly workspaceId?: Id;
  readonly source: ImportSource;
  readonly mainPath?: string; readonly engine?: CompileSettings["engine"]; readonly environmentId?: Id;
  readonly preserveHistory?: boolean; readonly keepConnected?: boolean;
};
export type RemoteImporter = (actorId: Id, input: RemoteImport, receipt: HttpReceipt) => Promise<Operation>;
export async function readImportReceipt<T>(service: CoreProjects, receipt: HttpReceipt, schema: z.ZodType<T>): Promise<T | null> {
  const prior = await service.context.db.get<{ response_json: string; request_digest: string }>(
    "SELECT response_json,request_digest FROM idempotency_results WHERE actor_id=? AND key=? AND route=?",
    [receipt.actorId, receipt.key, receipt.route]);
  if (!prior) return null;
  if (prior.request_digest !== receipt.digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Import key belongs to a different source");
  return z.object({ data: schema }).parse(JSON.parse(prior.response_json)).data;
}
export class InterchangeImports {
  constructor(private readonly dependencies: {
    readonly projects: CoreProjects; readonly http: SafeHttpClient; readonly converter: PandocConverter; readonly uploads: ImportUploads;
  }) {}
  async entries(input: NativeImport, actorId: Id): Promise<readonly NativeFile[]> {
    const source = await resolveSource(this.dependencies.http, input.source, { actorId, uploads: this.dependencies.uploads });
    let kind = input.kind;
    if (kind === "open-in") {
      if (source.mime.includes("wordprocessingml") || source.filename.toLowerCase().endsWith(".docx")) kind = "docx";
      else if (source.mime === "text/markdown" || /\.(md|markdown)$/i.test(source.filename)) kind = "markdown";
      else if (source.bytes[0] === 0x50 && source.bytes[1] === 0x4b) kind = "zip";
      else {
        const text = decodeText(source.bytes);
        if (text === null || (!text.includes("\\documentclass") && input.engine !== "plain")) throw new ServiceError("INVALID_MAIN", 422,
          "Open-in text requires an editable TeX documentclass; choose Markdown or DOCX conversion for other documents");
        return [{ path: input.mainPath ?? "main.tex", bytes: source.bytes }];
      }
    }
    switch (kind) {
      case "zip": return readZip(source.bytes);
      case "docx":
      case "markdown": {
        // DOCX is an archive too: reject hostile paths, expansion and special entries before Pandoc.
        if (kind === "docx") readZip(source.bytes);
        if (kind === "markdown" && decodeText(source.bytes) === null) throw new ServiceError("IMPORT_ENCODING", 422, "Markdown must be editable UTF-8 text");
        const filename = kind === "docx" ? "original.docx" : "original.md";
        const converted = await this.dependencies.converter.convert({
          entries: [{ path: filename, bytes: source.bytes }], main: filename, from: kind, to: "latex",
        });
        return [
          ...converted.map(file => ({ ...file, path: file.path === "document.tex" ? input.mainPath ?? "main.tex" : file.path })),
          { path: `originals/${filename}`, bytes: source.bytes },
        ];
      }
      default: return assertNever(kind);
    }
  }
  async create(actorId: Id, input: NativeImport & { readonly entries?: readonly NativeFile[] }, receipt: HttpReceipt): Promise<Operation> {
    const service = this.dependencies.projects;
    const user = await service.readUser(actorId);
    if (!user.verifiedEmails.includes(user.primaryEmail)) throw new ServiceError("EMAIL_VERIFICATION_REQUIRED", 403,
      "Verify the primary email address before importing a project");
    const projectReceipt = { ...receipt, route: `${receipt.route}:source` };
    // Source recovery makes the project receipt durable in the existing Git intent.
    // A crash before operation publication therefore cannot create a second project.
    await service.recoverReceipt(projectReceipt);
    const prior = await readImportReceipt(service, projectReceipt, ProjectSchema);
    let project: Project;
    if (prior) {
      project = prior;
    } else {
      project = await service.createFromFiles(actorId, {
        name: input.name, entries: input.entries ?? await this.entries(input, actorId), http: projectReceipt,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.mainPath ? { mainPath: input.mainPath } : {}),
        ...(input.engine ? { engine: input.engine } : {}),
        ...(input.environmentId ? { environmentId: input.environmentId } : {}),
      });
    }
    return recordOperation(service, {
      actorId, key: receipt.key, kind: `${input.kind}-import`, projectIds: [IdSchema.parse(project.id)], http: receipt,
      preflight: async bound => {
        await bound.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "read");
      },
    });
  }
}
