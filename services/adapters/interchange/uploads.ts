import { z } from "zod";
import { endpoints, IdSchema, ImportUploadSchema, InstantSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError, referenceBlob } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { actor, replay } from "../../core/base/http";
import { saveHttp } from "../../core/base/receipts";
import { limits } from "../../core/base/limits";
import { bounded } from "./sources";
import type { ResolvedSource } from "./sources";

export class ImportUploads {
  constructor(private readonly context: ModuleContext) {}
  async get(actorId: Id, id: Id) {
    const row = await this.context.db.get(
      `SELECT id,filename,mime,bytes,blob AS sha256,expires_at AS "expiresAt"
       FROM interchange_uploads WHERE id=? AND owner_id=?`, [id, actorId]);
    if (!row) throw new ServiceError("UPLOAD_NOT_FOUND", 404, "Upload is absent or belongs to another actor");
    const upload = ImportUploadSchema.parse(row);
    if (upload.expiresAt <= this.context.clock.now()) throw new ServiceError("UPLOAD_EXPIRED", 410,
      "Staged upload expired after 24 hours; upload the original file again");
    return upload;
  }
  async read(actorId: Id, id: Id): Promise<ResolvedSource> {
    const upload = await this.get(actorId, id);
    const bytes = bounded(await this.context.blobs.get(upload.sha256));
    if (bytes.length !== upload.bytes) throw new ServiceError("UPLOAD_BYTES_MISMATCH", 500, "Stored upload byte count is inconsistent");
    return { bytes, mime: upload.mime, filename: upload.filename };
  }
  register(): void {
    const context = this.context;
    context.routes.register(endpoints.importUploadCreate, async (input, request) => {
      const actorId = await actor(context, request);
      const file = input.body.file;
      if (file.size > limits.uploadBytes) throw new ServiceError("UPLOAD_LIMIT", 413, "Staged upload exceeds configured upload byte limit");
      const filename = z.string().min(1).max(255).refine(value =>
        value.split("").every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
      "Filename cannot contain control characters").parse(file.name);
      const mime = z.string().regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/).parse(file.type || "application/octet-stream");
      const bytes = bounded(new Uint8Array(await file.arrayBuffer()));
      const sha256 = await context.blobs.put(bytes);
      const staged = await replay(context, { actorId, request, route: "importUploadCreate",
        body: { filename, mime, sha256 }, schema: ImportUploadSchema }, async receipt => {
        const now = context.clock.now();
        const upload = ImportUploadSchema.parse({
          id: IdSchema.parse(crypto.randomUUID()), filename, mime, bytes: bytes.length, sha256,
          expiresAt: InstantSchema.parse(new Date(Date.parse(now) + 86_400_000).toISOString()),
        });
        await context.uow.run(async tx => {
          await tx.lock("quire:accounts");
          if (!await tx.get("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL AND suspended=0", [actorId])) {
            throw new ServiceError("UNAUTHENTICATED", 401, "Active upload owner required");
          }
          const usage = z.object({ bytes: z.number(), count: z.number() }).parse(await tx.get(
            `SELECT coalesce(sum(bytes),0) AS bytes,count(*) AS count FROM interchange_uploads
             WHERE owner_id=? AND expires_at>?`, [actorId, now]));
          if (usage.bytes + bytes.length > limits.uploadBytes * 4 || usage.count >= limits.uploadEntries) {
            throw new ServiceError("UPLOAD_QUOTA", 413, "Outstanding actor-owned uploads exceed quota; wait for expiry or import existing uploads");
          }
          await referenceBlob(tx, { digest: sha256, bytes: bytes.length }, context.clock);
          await tx.run(`INSERT INTO interchange_uploads(id,owner_id,blob,filename,mime,bytes,created_at,expires_at)
            VALUES(?,?,?,?,?,?,?,?)`, [upload.id, actorId, sha256, filename, mime, bytes.length, now, upload.expiresAt]);
          await saveHttp({ ...context, db: tx }, receipt, upload, null);
        });
        return upload;
      });
      if (staged.expiresAt <= context.clock.now()) throw new ServiceError("UPLOAD_EXPIRED", 410,
        "This idempotency key belongs to an expired staged upload; use a new key to upload again");
      return staged;
    });
    context.routes.register(endpoints.importUploadGet, async (input, request) =>
      this.get(await actor(context, request), input.params.id));
    context.routes.register(endpoints.importUploadContent, async (input, request) => {
      const source = await this.read(await actor(context, request), input.params.id);
      request.responseHeaders.set("content-type", source.mime);
      request.responseHeaders.set("content-disposition", `attachment; filename="upload.bin"; filename*=UTF-8''${encodeURIComponent(source.filename)}`);
      return new Uint8Array(source.bytes);
    });
  }
}
