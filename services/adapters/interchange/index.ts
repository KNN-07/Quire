import { endpoints, OperationSchema, ProjectSchema, assertNever } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, ServiceModule } from "@quire/runtime";
import { CoreProjects, provideProjectExporter, provideExternalLinks } from "../../core/base";
import type { ExternalLinks } from "../../core/base";
import { actor, replay } from "../../core/base/http";
import { SafeHttpClient } from "../shared";
import { InterchangeImports, readImportReceipt } from "./imports";
import type { NativeImport, RemoteImport, RemoteImporter } from "./imports";
import type { NativeFile } from "../../core/base";
import { InterchangeExports } from "./exports";
import { PandocConverter } from "./converter";
import { limits } from "../../core/base/limits";
import { sharedRemoteImporter } from "./remote";
import { ImportUploads } from "./uploads";
import { migrations } from "./migrations";
import { UrlLinks, composeExternalLinks } from "./links";

export function createInterchangeModule(options: {
  readonly http?: SafeHttpClient; readonly converter?: PandocConverter; readonly remoteImport?: RemoteImporter;
  readonly bibliographyLinks?: ExternalLinks;
} = {}): { readonly module: ServiceModule; readonly close: () => Promise<void> } {
  const converter = options.converter ?? new PandocConverter();
  const module: ServiceModule = {
    id: "065-x-interchange", lane: "X", order: 65, migrations,
    register(context: ModuleContext) {
      const projects = new CoreProjects(context);
      const http = options.http ?? new SafeHttpClient();
      const uploads = new ImportUploads(context);
      uploads.register();
      const imports = new InterchangeImports({ projects, http, converter, uploads });
      const exports = new InterchangeExports(projects, converter);
      const remoteImport = options.remoteImport ?? sharedRemoteImporter(context);
      provideProjectExporter(context, input => exports.export(input));
      provideExternalLinks(context, composeExternalLinks(projects, new UrlLinks(projects, http), options.bibliographyLinks));
      context.routes.register(endpoints.importCreate, async (input, request) => {
        const actorId = await actor(context, request);
        const body = input.body;
        const key = request.request.headers.get("idempotency-key");
        if (!key) throw new ServiceError("IDEMPOTENCY_KEY_REQUIRED", 400, "Import requires Idempotency-Key");
        if (body.source instanceof File && body.source.size > limits.uploadBytes) {
          throw new ServiceError("UPLOAD_LIMIT", 413, "Import exceeds configured upload byte limit");
        }
        const digestBody = body.source instanceof File ? {
          ...body, source: {
            name: body.source.name, mime: body.source.type,
            sha256: new Bun.CryptoHasher("sha256").update(await body.source.arrayBuffer()).digest("hex"),
          },
        } : body;
        const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(digestBody)).digest("hex");
        const receipt = { actorId, key, route: "importCreate", digest };
        const cached = await readImportReceipt(projects, receipt, OperationSchema);
        if (cached) return cached;
        // Conversion and URL downloads must not consume core's finite receipt lease.
        const common = { name: body.name, source: body.source,
          ...(body.workspaceId ? { workspaceId: body.workspaceId } : {}),
          ...(body.mainPath ? { mainPath: body.mainPath } : {}),
          ...(body.engine ? { engine: body.engine } : {}),
          ...(body.environmentId ? { environmentId: body.environmentId } : {}) };
        let prepared:
          | { readonly kind: "native"; readonly input: NativeImport; readonly entries?: readonly NativeFile[] }
          | { readonly kind: "remote"; readonly input: RemoteImport };
        switch (body.kind) {
          case "git":
          case "github": prepared = { kind: "remote", input: { ...common, kind: body.kind,
            ...(body.preserveHistory !== undefined ? { preserveHistory: body.preserveHistory } : {}),
            ...(body.keepConnected !== undefined ? { keepConnected: body.keepConnected } : {}),
          } }; break;
          case "zip":
          case "docx":
          case "markdown":
          case "open-in": {
            const native = { ...common, kind: body.kind };
            const user = await projects.readUser(actorId);
            if (!user.verifiedEmails.includes(user.primaryEmail)) throw new ServiceError("EMAIL_VERIFICATION_REQUIRED", 403,
              "Verify the primary email address before importing a project");
            const projectReceipt = { ...receipt, route: `${receipt.route}:source` };
            await projects.recoverReceipt(projectReceipt);
            const existing = await readImportReceipt(projects, projectReceipt, ProjectSchema);
            prepared = { kind: "native", input: native, ...existing ? {} : { entries: await imports.entries(native, actorId) } };
            break;
          }
          default: return assertNever(body.kind);
        }
        return replay(context, { actorId, request, route: "importCreate", body: digestBody, schema: OperationSchema }, async admitted => {
          if (!admitted) throw new ServiceError("IDEMPOTENCY_KEY_REQUIRED", 400, "Import requires Idempotency-Key");
          switch (prepared.kind) {
            case "remote":
              return remoteImport(actorId, prepared.input, admitted);
            case "native": return imports.create(actorId, { ...prepared.input,
              ...prepared.entries ? { entries: prepared.entries } : {} }, admitted);
            default: return assertNever(prepared);
          }
        });
      });
    },
  };
  return { module, close: () => converter.close() };
}
export { PandocConverter, conversionLosses } from "./converter";
export { InterchangeImports } from "./imports";
export type { NativeImport, RemoteImport, RemoteImporter } from "./imports";
export { InterchangeExports } from "./exports";
export { fetchSource, resolveSource } from "./sources";
export { UrlLinks } from "./links";
export { sharedRemoteImporter } from "./remote";
export { ImportUploads } from "./uploads";
export { migrations } from "./migrations";
