import { z } from "zod";
import { endpoints, IdSchema, ImportUploadSchema, OnboardingSchema,
  OnboardingImportRequestSchema, OperationSchema, resourceVersionTag } from "@quire/contracts";
import type { Id, OnboardingImportDraft, OnboardingImportRequest, SqlExecutor } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import type { IdentityDependencies } from "./credentials";
import { readOnboarding, writeOnboarding } from "./onboarding";
import { hash, newId } from "./store";

function requestFor(draft: OnboardingImportDraft, uploadId?: Id): OnboardingImportRequest {
  return OnboardingImportRequestSchema.parse({
    kind: draft.mode === "upload" ? "zip" : draft.mode, name: draft.name,
    ...(draft.workspaceId ? { workspaceId: draft.workspaceId } : {}),
    source: draft.mode === "upload" ? { kind: "upload", uploadId } : {
      kind: "git", url: draft.url, branch: draft.branch, ...(draft.grantId ? { grantId: draft.grantId } : {}),
    },
    ...(draft.mainPath ? { mainPath: draft.mainPath } : {}),
    ...(draft.engine ? { engine: draft.engine } : {}),
    ...(draft.environmentId ? { environmentId: draft.environmentId } : {}),
    ...(draft.preserveHistory !== undefined ? { preserveHistory: draft.preserveHistory } : {}),
    ...(draft.keepConnected !== undefined ? { keepConnected: draft.keepConnected } : {}),
  });
}
async function receipt(db: SqlExecutor, actorId: Id, route: string, key: Id, digest: string) {
  const value = await db.get("SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND route=? AND key=?",
    [actorId, route, key]);
  if (!value) return null;
  const row = z.object({ request_digest: z.string(), response_json: z.string() }).parse(value);
  if (row.request_digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Import receipt differs from the frozen attempt");
  return z.object({ data: z.unknown() }).parse(JSON.parse(row.response_json));
}

export function registerOnboardingImports(context: ModuleContext, { auth, repository }: IdentityDependencies): void {
  type Mutation = z.output<typeof endpoints.onboardingImportSave.input>["body"]
    | z.output<typeof endpoints.onboardingImportStart.input>["body"];
  const mutate = async (body: Mutation, request: RequestContext, route: string) => {
      const principal = await auth.mutation(request.request);
      if (body.actorId !== principal.user.id) throw new ServiceError("SESSION_CHANGED", 409, "Account changed; reload onboarding");
      const progress = await context.uow.run(async tx => {
        await tx.lock("quire:accounts");
        await repository.find(principal.user.id, tx);
        return repository.idempotent(tx, {
          actor: principal.user.id, route,
          key: request.request.headers.get("idempotency-key") ?? "", body, schema: OnboardingSchema,
        }, async () => {
          const current = await readOnboarding(tx, principal.user.id);
          if (current.version !== body.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Import choices changed; reload them");
          const state = current.importState;
          if (current.stage !== "import" || !state) throw new ServiceError("ONBOARDING_IMPORT_REQUIRED", 409, "Choose import as your starting point first");
          if (state.attempt) throw new ServiceError("IMPORT_STARTED", 409, "Resume the frozen import attempt instead of starting another");
          if ("draft" in body) {
            return writeOnboarding(context, tx, { ...current, version: current.version + 1,
              importState: { ...state, draft: body.draft } });
          }
          const file = body.file;
          if (!state.draft.name.trim()) throw new ServiceError("PROJECT_NAME_REQUIRED", 422, "Enter a project name");
          if (state.draft.mode === "upload" && !file) throw new ServiceError("FILE_REQUIRED", 422, "Choose the ZIP file before starting");
          if (state.draft.mode !== "upload" && file) throw new ServiceError("INVALID_IMPORT_SOURCE", 422, "A Git import does not accept a file");
          return writeOnboarding(context, tx, { ...current, version: current.version + 1,
            importState: { ...state, attempt: {
              key: newId(), uploadKey: file ? newId() : null, file, upload: null, operationId: null,
              request: file ? null : requestFor(state.draft),
            } } });
        });
      });
      request.responseHeaders.set("cache-control", "private, no-store");
      request.responseHeaders.set("etag", resourceVersionTag(progress.version));
      return progress;
  };
  context.routes.register(endpoints.onboardingImportSave, ({ body }, request) =>
    mutate(body, request, `PATCH:${endpoints.onboardingImportSave.path}`));
  context.routes.register(endpoints.onboardingImportStart, ({ body }, request) =>
    mutate(body, request, `POST:${endpoints.onboardingImportStart.path}`));
  context.routes.register(endpoints.onboardingImportRecover, async ({ body }, request) => {
    const principal = await auth.mutation(request.request);
    if (body.actorId !== principal.user.id) throw new ServiceError("SESSION_CHANGED", 409, "Account changed; reload onboarding");
    const result = await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await repository.find(principal.user.id, tx);
      const current = await readOnboarding(tx, principal.user.id);
      const state = current.importState;
      if (!state?.attempt) return { progress: current, operation: null };
      let attempt = state.attempt;
      if (attempt.file && attempt.uploadKey && !attempt.upload) {
        const staged = await receipt(tx, principal.user.id, "importUploadCreate", attempt.uploadKey,
          hash(JSON.stringify({ filename: attempt.file.filename, mime: attempt.file.mime, sha256: attempt.file.sha256 })));
        if (staged) {
          const upload = ImportUploadSchema.parse(staged.data);
          if (upload.bytes !== attempt.file.bytes) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Uploaded size differs from the frozen file");
          attempt = { ...attempt, upload, request: requestFor(state.draft, upload.id) };
        }
      }
      let operation = null;
      if (attempt.request) {
        // Hash exactly the canonical body accepted by the existing import route.
        const canonical = endpoints.importCreate.input.parse({ params: {}, query: {}, body: attempt.request,
          headers: { "idempotency-key": attempt.key } }).body;
        const published = await receipt(tx, principal.user.id, "importCreate", attempt.key, hash(JSON.stringify(canonical)));
        const row = await tx.get("SELECT id,kind,status,progress,result_json,error_code FROM operations WHERE actor_id=? AND idempotency_key=?",
          [principal.user.id, attempt.key]);
        if (row) {
          const saved = z.object({ id: IdSchema, kind: z.string(), status: z.string(), progress: z.number(),
            result_json: z.string().nullable(), error_code: z.string().nullable() }).parse(row);
          const expectedKind = { upload: "zip-import", github: "github.import", git: "git.clone" }[state.draft.mode];
          if (saved.kind !== expectedKind) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Operation belongs to a different import kind");
          operation = OperationSchema.parse({ id: saved.id, kind: saved.kind, status: saved.status, progress: saved.progress,
            result: saved.result_json === null ? null : JSON.parse(saved.result_json), errorCode: saved.error_code });
          if (published && OperationSchema.parse(published.data).id !== operation.id) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Operation receipt identity changed");
          attempt = { ...attempt, operationId: operation.id };
        } else if (published) {
          throw new ServiceError("IMPORT_OPERATION_MISSING", 409, "The recorded import operation is no longer available");
        }
      }
      let projectId = current.projectId;
      if (operation?.status === "succeeded") {
        const ids = z.array(IdSchema).length(1).safeParse(operation.result?.["projectIds"]);
        projectId = IdSchema.parse(operation.result?.["projectId"] ?? (ids.success ? ids.data[0] : undefined));
        if (!await tx.get("SELECT id FROM projects WHERE id=? AND owner_id=? AND deleted_at IS NULL", [projectId, principal.user.id])) {
          throw new ServiceError("IMPORT_PROJECT_UNAVAILABLE", 409, "The imported project is no longer available to this owner");
        }
      }
      const next = { ...current, importState: { ...state, attempt }, projectId,
        stage: projectId ? "complete" as const : current.stage };
      // Recovery derives only server facts; stale callers cannot overwrite drafts.
      const progress = JSON.stringify(next) === JSON.stringify(current) ? current
        : await writeOnboarding(context, tx, { ...next, version: current.version + 1 });
      return { progress, operation };
    });
    request.responseHeaders.set("cache-control", "private, no-store");
    request.responseHeaders.set("etag", resourceVersionTag(result.progress.version));
    return result;
  });
}
