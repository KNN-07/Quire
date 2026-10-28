import { z } from "zod";
import { resourceVersionTag, assertNever } from "@quire/contracts";
import type { Id, Scope } from "@quire/contracts";
import type { RequestContext, Transaction } from "@quire/runtime";
import { ReviewStore, fail } from "./store";

type Mutation<T> = {
  readonly actorId: Id; readonly request: RequestContext; readonly route: string;
  readonly scope: Scope; readonly body: unknown; readonly schema: z.ZodType<T>;
  readonly work: (store: ReviewMutations) => Promise<T>;
};
export class ReviewMutations extends ReviewStore {
  override withTransaction(tx: Transaction): ReviewMutations {
    return new ReviewMutations({ ...this.context, db: tx }, this.projects.withTransaction(tx));
  }
  async mutate<T>(input: Mutation<T>): Promise<T> {
    return this.projects.serialized(input.scope, async lease => {
      // Recheck current permissions after waiting for a preceding branch writer.
      const action = input.route === "chatCreate" ? "chat" : input.route === "suggestionCreate" ? "suggestion.create"
        : input.route === "threadCreate" ? "thread.create" : ["threadReply", "commentPatch", "commentDelete"].includes(input.route)
          ? "comment" : "write";
      await this.context.services.get("identity").require(input.request.request);
      await this.authorizeRead(input.request.request, input.scope);
      await this.projects.authorize(input.actorId, input.scope, action);
      switch (action) {
        case "chat":
          if (!(await this.projects.policy(input.actorId, input.scope.projectId)).chat) fail("CHAT_DISABLED", 403, "Chat is disabled by policy");
          break;
        case "suggestion.create":
          if (!(await this.projects.policy(input.actorId, input.scope.projectId)).trackChanges) fail("TRACKING_DISABLED", 403, "Tracked changes are disabled");
          break;
        case "thread.create":
        case "comment":
        case "write": break;
        default: assertNever(action);
      }
      const key = input.request.request.headers.get("idempotency-key");
      const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input.body)).digest("hex");
      const result = await this.context.uow.run(async tx => {
        await tx.lock("quire:accounts");
        await this.context.branches.assert(tx, lease);
        const bound = this.withTransaction(tx);
        await bound.assertSession(input.request.request, input.actorId, input.scope);
        await bound.projects.authorize(input.actorId, input.scope, action);
        const policy = await bound.projects.policy(input.actorId, input.scope.projectId);
        if (action === "chat" && !policy.chat) fail("CHAT_DISABLED", 403, "Chat is disabled");
        if (action === "suggestion.create" && !policy.trackChanges) fail("TRACKING_DISABLED", 403, "Tracking is disabled");
        if (key) {
          const cached = (await tx.get<{ request_digest: string; response_json: string }>("SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?", [input.actorId, key, input.route]));
          if (cached) {
            if (cached.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Key has different input");
            const receipt = z.object({ data: input.schema, etag: z.string().nullable() }).parse(JSON.parse(cached.response_json));
            if (receipt.etag) input.request.responseHeaders.set("etag", receipt.etag);
            return JSON.stringify(receipt.data);
          }
        }
        const value = input.schema.parse(await input.work(bound));
        (await bound.changed(input.scope));
        if (key) (await tx.run(`INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at)
          VALUES(?,?,?,?,200,?,?)`, [input.actorId, key, input.route, digest, JSON.stringify({ data: value, etag: input.request.responseHeaders.get("etag") }), this.context.clock.now()]));
        return JSON.stringify(value);
      });
      await this.context.events.dispatch();
      return input.schema.parse(JSON.parse(result));
    });
  }
  version(request: RequestContext, version: number): void {
    request.responseHeaders.set("etag", resourceVersionTag(version));
  }
}
