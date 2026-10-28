import { z } from "zod";
import type { Endpoint, Transaction, Id } from "@quire/contracts";
import type { ModuleContext, Principal, RequestContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";

type Bound = Omit<ModuleContext, "db"> & { readonly db: Transaction };
type Action<I> = {
  readonly input: I; readonly principal: Principal; readonly request: RequestContext;
  readonly context: Bound;
};
/** Authorization precedes receipt replay and is repeated under the mutation lock. */
export function route<I extends z.ZodType, O extends z.ZodType>(
  context: ModuleContext, endpoint: Endpoint<I, O>,
  action: (call: Action<z.output<I>>) => Promise<z.input<NoInfer<O>>>,
): void {
  context.routes.register(endpoint, async (input, request) => {
    const identity = context.services.get("identity");
    const principal = await identity.require(request.request);
    const mutation = endpoint.method !== "GET";
    if (mutation) await identity.verifyMutation(request.request, principal);
    const result = await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:compiler");
      const current = z.object({ operator: z.number(), created_at: z.string() }).nullable().parse(
        await tx.get(`SELECT u.operator,s.created_at FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.id=? AND u.id=? AND s.expires_at>? AND u.suspended=0 AND u.deleted_at IS NULL`,
        [principal.sessionId, principal.user.id, context.clock.now()]));
      if (!current) throw new ServiceError("UNAUTHENTICATED", 401, "Current session required");
      if (current.operator !== 1) throw new ServiceError("FORBIDDEN", 403, "Current operator access required");
      if (mutation && Date.parse(context.clock.now()) - Date.parse(current.created_at) > 900000) {
        throw new ServiceError("FRESH_AUTH_REQUIRED", 403, "Sign in again before changing workers");
      }
      const key = request.request.headers.get("idempotency-key");
      const routeKey = `${endpoint.method} ${new URL(request.request.url).pathname}`;
      const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex");
      if (endpoint.idempotent && key) {
        const replay = z.object({ request_digest: z.string(), response_json: z.string() }).nullable().parse(
          await tx.get("SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?",
            [principal.user.id, key, routeKey]));
        if (replay) {
          if (replay.request_digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Key already used for different input");
          return endpoint.output.parse(JSON.parse(replay.response_json));
        }
      }
      const output = endpoint.output.parse(await action({
        input, principal, request, context: { ...context, db: tx },
      }));
      if (endpoint.idempotent && key) await tx.run(`INSERT INTO idempotency_results
        (actor_id,key,route,request_digest,status,response_json,created_at) VALUES(?,?,?,?,?,?,?)`,
        [principal.user.id, key, routeKey, digest, endpoint.successStatus, JSON.stringify(output), context.clock.now()]);
      return output;
    });
    await context.events.dispatch();
    return endpoint.output.encode(result);
  });
}
export async function audit(context: Bound, actor: Id, event: string): Promise<void> {
  await context.db.run(`INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json)
    VALUES(?,?,?,?,?,'{}')`, [crypto.randomUUID(), context.clock.now(), actor, event, actor]);
}
