import { z } from "zod";
import { DigestSchema, IdSchema } from "@quire/contracts";
import { referenceBlob, ServiceError } from "@quire/runtime";
import type { AiStore } from "./store";
import { newId } from "./model";
import type { Actor, CreateRun, RunContext, SelectedFile } from "./model";
import type { Id, SqlExecutor } from "@quire/contracts";
import { isCodePointBoundary } from "../../core/base/unicode";

export function checkContextSize(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) {
    throw new ServiceError("AI_CONTEXT_TOO_LARGE", 413, "Explicit context and prompt exceed 256 KiB");
  }
}
const imageRow = z.object({ mime: z.enum(["image/png", "image/jpeg"]), digest: DigestSchema, bytes: z.number() });
export async function collectContext(store: AiStore, actor: Actor, request: CreateRun): Promise<RunContext> {
  if (!request.diagnosticId && request.tool !== "citation-reviewer") return collectSelectedContext(store, actor, request, store.context.db);
  return store.context.uow.run(async tx => {
    // Source finalization takes this same lock before advancing the branch.
    await tx.lock("quire:accounts");
    await store.authorize(actor, request, tx);
    return collectSelectedContext(store, actor, request, tx);
  });
}
async function collectSelectedContext(store: AiStore, actor: Actor, request: CreateRun, db: SqlExecutor): Promise<RunContext> {
  if (new Set(request.fileIds).size !== request.fileIds.length) throw new ServiceError("AI_CONTEXT_INVALID", 400, "Select distinct files");
  if (request.selection && !request.fileIds.includes(request.selection.fileId)) throw new ServiceError("AI_CONTEXT_INVALID", 400, "Selection file must be explicit");
  const files: SelectedFile[] = [];
  for (const id of request.fileIds) {
    const document = await store.core(db).readDocument(request.scope, id);
    const selection = request.selection?.fileId === id ? request.selection : undefined;
    if (selection && (selection.to > document.text.length || selection.from > selection.to ||
      !isCodePointBoundary(document.text, selection.from) || !isCodePointBoundary(document.text, selection.to)
      || document.text.slice(selection.from, selection.to) !== selection.text)) throw new ServiceError("AI_SELECTION_CONFLICT", 409, "Selected text changed or splits a character");
    files.push({ id, path: document.file.path, text: document.text, state: document.updateBase64,
      epoch: document.file.version.epoch, revision: document.file.version.revision,
      from: selection?.from ?? 0, to: selection?.to ?? document.text.length });
  }
  let diagnostic: string | null = null;
  if (request.tool === "error-fix" && !request.diagnosticId) throw new ServiceError("AI_DIAGNOSTIC_REQUIRED", 400, "Choose an actual compiler diagnostic");
  if (request.diagnosticId) {
    const row = await db.get(`SELECT d.*,s.project_id,s.branch,s.revision AS snapshot_revision,a.sha256 FROM diagnostics d
      JOIN compile_jobs j ON j.id=d.job_id JOIN snapshots s ON s.id=j.snapshot_id
      JOIN artifacts a ON a.job_id=j.id AND a.kind='log' WHERE d.id=? AND s.project_id=? AND s.branch=?`,
    [request.diagnosticId, request.scope.projectId, request.scope.branch]);
    if (!row) throw new ServiceError("AI_DIAGNOSTIC_NOT_FOUND", 404, "Diagnostic and log must belong to this project branch");
    const parsed = z.object({ message: z.string(), raw_start: z.number(), raw_end: z.number(),
      snapshot_revision: z.number().int().nonnegative(), sha256: DigestSchema }).parse(row);
    if ((await store.core(db).getBranch(request.scope)).revision !== parsed.snapshot_revision) {
      throw new ServiceError("AI_DIAGNOSTIC_STALE", 409, "Source changed since this diagnostic; recompile before requesting a fix");
    }
    const bytes = await store.context.blobs.get(parsed.sha256);
    diagnostic = `${parsed.message}\n${new TextDecoder().decode(bytes.slice(parsed.raw_start, parsed.raw_end))}`;
  }
  const images: RunContext["images"][number][] = [];
  for (const id of request.imageUploadIds ?? []) {
    const row = await db.get(`SELECT mime,digest,bytes FROM ai_images
      WHERE id=? AND actor_id=? AND session_id=? AND project_id=? AND expires_at>?`,
    [id, actor.id, actor.sessionId, request.scope.projectId, store.context.clock.now()]);
    if (!row) throw new ServiceError("AI_IMAGE_NOT_FOUND", 404, "Image expired or belongs to another session/project");
    const parsed = imageRow.parse(row);
    images.push({ mime: parsed.mime, bytes: await store.context.blobs.get(parsed.digest) });
  }
  if (images.reduce((total, image) => total + image.bytes.byteLength, 0) > 10 * 1024 * 1024) {
    throw new ServiceError("AI_IMAGES_TOO_LARGE", 413, "Combined PNG/JPEG input exceeds 10 MiB");
  }
  if ((request.tool === "table-image" || request.tool === "equation-image") && !images.length) {
    throw new ServiceError("AI_IMAGE_REQUIRED", 400, "This tool requires an uploaded PNG or JPEG");
  }
  checkContextSize({ prompt: request.prompt, files: files.map(file => ({ id: file.id, path: file.path,
    text: file.text.slice(file.from, file.to) })), diagnostic });
  return { files, images, diagnostic };
}
export async function uploadImage(store: AiStore, actor: Actor, input: {
  readonly projectId: Id; readonly mime: "image/png" | "image/jpeg"; readonly dataBase64: string;
}) {
  const project = await store.core().getProject(input.projectId);
  const authority = { scope: { projectId: input.projectId, branch: project.defaultBranch }, mode: "ask" as const };
  await store.authorize(actor, authority);
  if (input.dataBase64.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataBase64)) {
    throw new ServiceError("AI_IMAGE_INVALID", 413, "PNG/JPEG must be valid base64 and at most 10 MiB");
  }
  const bytes = Buffer.from(input.dataBase64, "base64");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (bytes.length > 10 * 1024 * 1024 || (input.mime === "image/png" ? !png : !jpeg)) {
    throw new ServiceError("AI_IMAGE_INVALID", 422, "Image signature does not match PNG/JPEG content type");
  }
  const digest = await store.context.blobs.put(bytes);
  const id = IdSchema.parse(crypto.randomUUID());
  await store.context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await store.authorize(actor, authority, tx);
    await referenceBlob(tx, { digest, bytes: bytes.length }, store.context.clock);
    await tx.run("INSERT INTO ai_images(id,project_id,actor_id,session_id,mime,bytes,digest,expires_at) VALUES(?,?,?,?,?,?,?,?)",
      [id, input.projectId, actor.id, actor.sessionId, input.mime, bytes.length, digest,
        new Date(Date.parse(store.context.clock.now()) + 3600_000).toISOString()]);
    await store.audit(tx, { actorId: actor.id, targetId: newId(), event: "ai.image.uploaded" });
  });
  return { id, bytes: bytes.length, mime: input.mime };
}
