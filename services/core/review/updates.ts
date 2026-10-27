import { z } from "zod";
import * as Y from "yjs";
import { RealtimeServerMessageSchema } from "@quire/contracts";
import type { Scope, RealtimeClientMessage } from "@quire/contracts";
import { ReviewStore, fail } from "./store";

type Update = Extract<RealtimeClientMessage, { readonly type: "update" }>;
const receiptSchema = z.object({ request_digest: z.string(), response_json: z.string() });
export class DocumentUpdates extends ReviewStore {
  async update(request: Request, scope: Scope, message: Update) {
    return this.projects.serialized(scope, async () => {
      const principal = await this.context.services.get("identity").require(request);
      const actorId = principal.user.id;
      await this.authorizeRead(request, scope);
      await this.projects.authorizeRequest(request, scope, "document.update");
      await this.projects.authorize(actorId, scope, "document.update");
      const file = this.projects.getFile(scope, message.fileId);
      if (!file.editable || file.link) fail("NOT_EDITABLE", 403, "File is not editable");
      if (file.version.epoch !== message.epoch) fail("EPOCH_CHANGED", 409, "Document was replaced; recover offline edits explicitly");
      const route = `realtime:${scope.projectId}:${scope.branch}:${file.id}:${message.epoch}:${message.clientId}`;
      const key = String(message.clientSeq);
      const digest = new Bun.CryptoHasher("sha256").update(message.updateBase64).digest("hex");
      const cached = this.context.db.query("SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND route=? AND key=?")
        .get(actorId, route, key);
      if (cached) {
        const receipt = receiptSchema.parse(cached);
        if (receipt.request_digest !== digest) fail("SEQUENCE_CONFLICT", 409, "Client sequence has different bytes");
        return RealtimeServerMessageSchema.parse(JSON.parse(receipt.response_json));
      }
      const last = z.object({ seq: z.number().nullable() }).parse(this.context.db.query(
        "SELECT max(CAST(key AS INTEGER)) AS seq FROM idempotency_results WHERE actor_id=? AND route=?").get(actorId, route)).seq;
      if (last === null ? message.clientSeq > 1 : message.clientSeq !== last + 1) {
        fail("SEQUENCE_GAP", 409, "Sync and resend missing client sequences first");
      }
      const doc = new Y.Doc();
      try {
        doc.getText("source");
        Y.applyUpdate(doc, Buffer.from(this.projects.loadDocument(scope, file.id).state, "base64"));
        const update = Buffer.from(message.updateBase64, "base64");
        if (update.length > 2 * 1024 * 1024) fail("UPDATE_TOO_LARGE", 413, "Update exceeds 2 MiB");
        try { Y.applyUpdate(doc, update); }
        catch (error) {
          if (error instanceof Error) fail("INVALID_UPDATE", 400, "Invalid Yjs update");
          throw error;
        }
        if ([...doc.share.keys()].some(name => name !== "source") || !(doc.get("source") instanceof Y.Text)) {
          fail("INVALID_UPDATE", 400, "Only the authorized source text may be changed");
        }
        const delta = z.array(z.object({ insert: z.unknown(), attributes: z.unknown().optional() })).parse(doc.getText("source").toDelta());
        if (delta.some(part => typeof part.insert !== "string" || part.attributes !== undefined)) {
          fail("INVALID_UPDATE", 400, "Source text cannot contain embeds or formatting");
        }
        const ack = RealtimeServerMessageSchema.parse({ type: "ack", clientId: message.clientId,
          clientSeq: message.clientSeq, revision: this.projects.getBranch(scope).revision + 1 });
        await this.projects.commitSource({ actorId, scope, expectedRevision: this.projects.getBranch(scope).revision,
          inputs: this.projects.listFiles(scope).map(entry => ({ file: entry, ...(entry.id === file.id ? { document: doc } : {}) })),
          receipt: { actorId, key, route, digest, response: JSON.stringify(ack) } });
        return ack;
      } finally { doc.destroy(); }
    });
  }
}
