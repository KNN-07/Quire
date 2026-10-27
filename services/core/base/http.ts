import { z } from "zod";
import { resourceVersionTag } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import { fail } from "./store";

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
/** Serialize HTTP mutations across awaits; persist successful replay in the same DB as the aggregate. */
export async function replay<T>(context: ModuleContext, input: {
  readonly actorId: Id; readonly request: RequestContext; readonly route: string; readonly body: unknown;
  readonly schema: z.ZodType<T>; readonly redact?: boolean;
}, work: () => Promise<T>): Promise<T> {
  const run = async () => {
    const key = input.request.request.headers.get("idempotency-key");
    if (!key) return work();
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input.body)).digest("hex");
    const cached = context.db.query<{ request_digest: string; response_json: string }, [string, string, string]>(
      "SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?")
      .get(input.actorId, key, input.route);
    if (cached) {
      if (cached.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Key reused for another request");
      const receipt = JSON.parse(cached.response_json);
      const stored = storedResponse.parse(receipt);
      if (stored.etag) input.request.responseHeaders.set("etag", stored.etag);
      return input.schema.parse(stored.data);
    }
    const result = await work();
    context.uow.local((tx) => tx.query(`INSERT INTO idempotency_results
      (actor_id,key,route,request_digest,status,response_json,created_at) VALUES(?,?,?,?,200,?,?)`)
      .run(input.actorId, key, input.route, digest, JSON.stringify({
        data: input.redact ? {} : result, etag: input.request.responseHeaders.get("etag"),
      }), context.clock.now()));
    return result;
  };
  const result = (tails.get(context.db) ?? Promise.resolve()).then(run);
  tails.set(context.db, result.then(() => undefined, () => undefined));
  return result;
}
const storedResponse = z.object({ data: z.unknown(), etag: z.string().nullable() });
