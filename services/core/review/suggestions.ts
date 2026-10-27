import { z } from "zod";
import { endpoints, SuggestionSchema, assertNever } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { ReviewMutations } from "./mutations";
import { checkAnchor } from "./threads";
import { compare, fail, uuid } from "./store";
import { decisionId, finishDecisions } from "./decisions";
import { notifyReview } from "./notifications";

export function registerSuggestions(context: ModuleContext, store: ReviewMutations): void {
  let decisionTail: Promise<unknown> = Promise.resolve();
  context.routes.register(endpoints.suggestionCreate, async (input, request) => {
    const scope = store.scope(input.params.p, input.body.scope);
    const actorId = await store.write(request, scope, "suggestion.create");
    if (!(await store.projects.policy(actorId, scope.projectId)).trackChanges) fail("TRACKING_DISABLED", 403, "Tracked changes are disabled");
    return store.mutate({ actorId, request, scope, route: "suggestionCreate", body: input, schema: SuggestionSchema, work: () => {
      compare(store.projects.getBranch(scope).revision, input.body.expectedVersion);
      if (!input.body.edits.length) fail("EMPTY_SELECTION", 400, "At least one edit is required");
      for (const edit of input.body.edits) {
        if (edit.fileId !== edit.anchor.fileId || edit.before !== edit.anchor.quote
          || edit.baseRevision > store.projects.getBranch(scope).revision) fail("ANCHOR_CONFLICT", 409, "Edit and anchor differ");
        checkAnchor(store, scope, edit.anchor);
      }
      const id = uuid();
      context.db.query("INSERT INTO suggestions(id,project_id,branch,author_id,origin,created_at) VALUES(?,?,?,?,'human',?)")
        .run(id, scope.projectId, scope.branch, actorId, context.clock.now());
      for (const edit of input.body.edits) context.db.query(`INSERT INTO suggestion_edits
        (id,suggestion_id,file_id,anchor_json,before_text,after_text,base_revision) VALUES(?,?,?,?,?,?,?)`)
        .run(uuid(), id, edit.fileId, JSON.stringify(edit.anchor), edit.before, edit.after, edit.baseRevision);
      store.version(request, 0);
      const suggestion = store.suggestion(id, scope.projectId).dto;
      notifyReview(store, { type: "suggestion", suggestion, actorId, eventId: `suggestion:${id}:created` });
      return suggestion;
    } });
  });
  context.routes.register(endpoints.suggestionDecide, async (input, request) => {
    const pending = decisionTail.then(async () => {
    if (!input.body.ids.length || new Set(input.body.ids).size !== input.body.ids.length) fail("EMPTY_SELECTION", 400, "Select distinct suggestions");
    const suggestions = input.body.ids.map(id => store.suggestion(id, input.params.p));
    const first = suggestions[0];
    if (!first) fail("EMPTY_SELECTION", 400, "Select suggestions");
    const scope = first.dto.scope;
    if (suggestions.some(item => item.dto.scope.branch !== scope.branch)) fail("SCOPE_MISMATCH", 400, "Suggestions span branches");
    const actorId = await store.write(request, scope, "suggestion.decide");
    // Source receipt is the durable decision journal. Retrying after a crash resumes metadata,
    // and ProjectPort applies selected edits exactly once through its branch queue.
    const key = request.request.headers.get("idempotency-key");
    if (!key) fail("IDEMPOTENCY_KEY_REQUIRED", 400, "Idempotency-Key required");
    const route = `suggestionDecide:${scope.projectId}:${scope.branch}`;
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex");
    const cached = context.db.query<{ request_digest: string; response_json: string }, [string, string, string]>(
      "SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?").get(actorId, key, route);
    if (cached) {
      if (cached.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Decision key has different input");
      return z.array(SuggestionSchema).parse(JSON.parse(cached.response_json));
    }
    const edits = suggestions.flatMap(item => item.dto.edits).filter(edit =>
      !input.body.editIds || input.body.editIds.includes(edit.id));
    if (!edits.length || input.body.editIds?.some(id => !edits.some(edit => edit.id === id))) fail("EMPTY_SELECTION", 400, "Unknown selected edit");
    const journalKey = `review-decision:${key}:${digest}`;
    const applied = context.db.query("SELECT 1 FROM idempotency_results WHERE actor_id=? AND key=? AND route=?")
      .get(actorId, journalKey, `applyEdits:${scope.projectId}:${scope.branch}`);
    if (!applied) compare(store.projects.getBranch(scope).revision, input.body.expectedVersion);
    if (edits.some(edit => edit.status !== "pending")) fail("ALREADY_DECIDED", 409, "Selected edit is already decided");
    let conflicts: readonly string[] = [];
    switch (input.body.decision) {
      case "accept": {
      const plan = { actorId, scope, ids: [...input.body.ids], editIds: edits.map(edit => edit.id), key,
        route, digest, sourceKey: journalKey };
      context.uow.local(tx => tx.query("INSERT OR REPLACE INTO review_decision_intents(id,payload_json) VALUES(?,?)")
        .run(decisionId(plan), JSON.stringify(plan)));
      const result = await store.projects.applyEdits(actorId, scope, edits, journalKey);
      conflicts = result.conflicts;
      if (!conflicts.length) {
        finishDecisions(store);
        const done = z.object({ response_json: z.string() }).parse(context.db.query(
          "SELECT response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?").get(actorId, key, route));
        context.events.dispatch();
        return z.array(SuggestionSchema).parse(JSON.parse(done.response_json));
      }
      break;
      }
      case "reject": break;
      default: assertNever(input.body.decision);
    }
    return store.projects.serialized(scope, async () => {
      await store.projects.authorize(actorId, scope, "suggestion.decide");
      const result = context.uow.local(tx => {
        // All selected edits either apply together or remain pending except the divergent edits.
        for (const edit of edits) {
          const status = conflicts.length ? (conflicts.includes(edit.id) ? "conflict" : "pending") : "rejected";
          tx.query("UPDATE suggestion_edits SET status=?,version=version+1 WHERE id=? AND status='pending'").run(status, edit.id);
        }
        for (const item of suggestions) tx.query("UPDATE suggestions SET version=version+1 WHERE id=?").run(item.dto.id);
        const dtos = suggestions.map(item => store.suggestion(item.dto.id, scope.projectId).dto);
        for (const suggestion of dtos) notifyReview(store, { type: "suggestion", suggestion, actorId,
          eventId: `suggestion:${suggestion.id}:decision:${actorId}:${key}` });
        tx.query(`INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at)
          VALUES(?,?,?,?,200,?,?)`).run(actorId, key, route, digest, JSON.stringify(dtos), context.clock.now());
        tx.query("DELETE FROM review_decision_intents WHERE id=?").run(`${actorId}:${route}:${key}`);
        store.changed(scope);
        return dtos;
      });
      context.events.dispatch();
      return result;
    });
    });
    decisionTail = pending.then(() => undefined, () => undefined);
    return pending;
  });
}
