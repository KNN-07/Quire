import { z } from "zod";
import { resourceVersionTag, assertNever } from "@quire/contracts";
import type { Id, Scope } from "@quire/contracts";
import type { RequestContext } from "@quire/runtime";
import { ReviewStore, fail } from "./store";

type Mutation<T> = {
  readonly actorId: Id; readonly request: RequestContext; readonly route: string;
  readonly scope: Scope; readonly body: unknown; readonly schema: z.ZodType<T>;
  readonly work: () => T;
};
export class ReviewMutations extends ReviewStore {
  async mutate<T>(input: Mutation<T>): Promise<T> {
    return this.projects.serialized(input.scope, async () => {
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
      const result = this.context.uow.local(tx => {
        if (key) {
          const cached = tx.query<{ request_digest: string; response_json: string }, [string, string, string]>(
            "SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?")
            .get(input.actorId, key, input.route);
          if (cached) {
            if (cached.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Key has different input");
            const receipt = z.object({ data: input.schema, etag: z.string().nullable() }).parse(JSON.parse(cached.response_json));
            if (receipt.etag) input.request.responseHeaders.set("etag", receipt.etag);
            return JSON.stringify(receipt.data);
          }
        }
        const value = input.schema.parse(input.work());
        this.changed(input.scope);
        if (key) tx.query(`INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at)
          VALUES(?,?,?,?,200,?,?)`).run(input.actorId, key, input.route, digest,
          JSON.stringify({ data: value, etag: input.request.responseHeaders.get("etag") }), this.context.clock.now());
        return JSON.stringify(value);
      });
      this.context.events.dispatch();
      return input.schema.parse(JSON.parse(result));
    });
  }
  version(request: RequestContext, version: number): void {
    request.responseHeaders.set("etag", resourceVersionTag(version));
  }
}
