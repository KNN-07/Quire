import { createHmac } from "node:crypto";
import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import type { Id, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";

const Inquiry = z.strictObject({
  name: z.string().trim().min(1).max(200), email: z.email().max(320),
  organization: z.string().max(300), users: z.number().int().nonnegative().max(100000000),
  runtime: z.string().max(200), airGapped: z.boolean(), message: z.string().trim().min(1).max(20000),
}).readonly();
export type SupportInquiry = z.infer<typeof Inquiry> & { readonly id: Id };
export type InquiryOutbox = {
  /** Resolves actual configured recipient; null means no support destination is configured. */
  readonly recipient: () => string | null;
  /** SQL-only durable enqueue. Must not perform network I/O inside this transaction. */
  readonly enqueue: (tx: Transaction, inquiry: SupportInquiry) => Promise<void>;
};

export function registerInquiries(context: ModuleContext, outbox?: InquiryOutbox): void {
  context.routes.register(endpoints.supportInquiry, async (input, request) => {
    if (request.request.headers.get("origin") !== new URL(context.config.publicUrl).origin) {
      throw new ServiceError("ORIGIN_DENIED", 403, "Same-origin inquiry required");
    }
    const inquiry = Inquiry.parse(input.body);
    const key = z.string().min(1).max(200).parse(input.headers["idempotency-key"]);
    const requestKey = createHmac("sha256", context.secretKey)
      .update(JSON.stringify([inquiry.email.toLowerCase(), key])).digest("hex");
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(inquiry)).digest("hex");
    const principal = await context.services.get("identity").authenticate(request.request);
    const result = await context.uow.run(async tx => {
      await tx.lock("quire:support-inquiries");
      const previous = z.object({ id: IdSchema, request_digest: z.string(), status: z.string() })
        .nullable().parse(await tx.get("SELECT id,request_digest,status FROM support_inquiries WHERE request_key=?", [requestKey]));
      if (previous && previous.request_digest !== digest) {
        throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Inquiry key already used for different input");
      }
      if (previous?.status === "queued") return { id: previous.id, queued: true };
      const id = previous?.id ?? IdSchema.parse(crypto.randomUUID());
      const now = context.clock.now();
      if (!previous) await tx.run(`INSERT INTO support_inquiries
        (id,request_key,request_digest,actor_id,request_json,status,created_at)
        VALUES(?,?,?,?,?,'unconfigured',?)`, [id, requestKey, digest, principal?.user.id ?? null, JSON.stringify(inquiry), now]);
      if (!outbox?.recipient()) return { id, queued: false };
      await outbox.enqueue(tx, { id, ...inquiry });
      await tx.run("UPDATE support_inquiries SET status='queued',queued_at=? WHERE id=?", [now, id]);
      return { id, queued: true };
    });
    if (!result.queued) throw new ServiceError("SUPPORT_UNCONFIGURED", 503, {
      message: "Inquiry saved locally; no outbound support recipient is configured",
      details: { inquiryId: result.id },
    });
    return { ok: true as const, version: 1 };
  });
}
