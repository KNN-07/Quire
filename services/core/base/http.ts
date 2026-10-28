import { z } from "zod";
import { IdSchema, resourceVersionTag } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import { fail } from "./store";
import { SourceService } from "./source";
import { saveReceipt } from "./receipts";
import type { HttpReceipt } from "./receipts";

export async function actor(context: ModuleContext, request: RequestContext): Promise<Id> {
  const identity = context.services.get("identity");
  const principal = await identity.require(request.request);
  if (!["GET", "HEAD"].includes(request.request.method)) await identity.verifyMutation(request.request, principal);
  return principal.user.id;
}
export function etag(request: RequestContext, version: number): void {
  request.responseHeaders.set("etag", resourceVersionTag(version));
}
export function checkMatch(request: RequestContext, version: number): void {
  const match = request.request.headers.get("if-match");
  if (match && match !== resourceVersionTag(version)) fail("STALE_VERSION", 409, "If-Match does not match resource");
}
const tails = new WeakMap<object, Promise<unknown>>();
const storedResponse = z.object({ data: z.unknown(), etag: z.string().nullable() });

/** The handler attaches this identity to its aggregate finalization transaction. */
export async function replay<T>(context: ModuleContext, input: {
  readonly actorId: Id; readonly request: RequestContext; readonly route: string; readonly body: unknown;
  readonly schema: z.ZodType<T>; readonly redact?: boolean;
}, work: (receipt?: HttpReceipt) => Promise<T>): Promise<T> {
  const run = async () => {
    const key = input.request.request.headers.get("idempotency-key");
    if (!key) return work();
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input.body)).digest("hex");
    const receipt = { actorId: input.actorId, key, route: input.route, digest };
    const hash = new Bun.CryptoHasher("sha256").update(JSON.stringify([input.actorId, input.route, key])).digest("hex");
    const projectId = IdSchema.parse(`${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`);
    const lease = await context.branches.acquire({ projectId, branch: "http-receipt" }, crypto.randomUUID(), 60_000);
    if (!lease) fail("REQUEST_BUSY", 409, "The same request is still being finalized");
    try {
      await new SourceService(context).recoverReceipt(receipt);
      const read = async () => {
        const cached = await context.db.get<{ request_digest: string; response_json: string }>(
          "SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?",
          [input.actorId, key, input.route]);
        if (!cached) return null;
        if (cached.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Key reused for another request");
        return storedResponse.parse(JSON.parse(cached.response_json));
      };
      const cached = await read();
      if (cached) {
        if (cached.etag) input.request.responseHeaders.set("etag", cached.etag);
        return input.schema.parse(cached.data);
      }
      const result = await work(receipt);
      // Delegated adapters retain their own operation idempotency. Base producers
      // have already saved the receipt with their aggregate before returning.
      if (!await read()) {
        await context.uow.run(async tx => {
          await tx.lock("quire:accounts");
          await context.branches.assert(tx, lease);
          await saveReceipt({ ...context, db: tx }, {
            ...receipt, response: JSON.stringify({
              data: input.redact ? {} : result, etag: input.request.responseHeaders.get("etag"),
            })
          });
        });
      }
      return result;
    } finally { await context.branches.release(lease); }
  };
  const result = (tails.get(context.db) ?? Promise.resolve()).then(run);
  tails.set(context.db, result.then(() => undefined, () => undefined));
  return result;
}
