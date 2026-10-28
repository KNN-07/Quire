import { z } from "zod";
import { endpoints, SuggestionSchema, assertNever } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { ReviewMutations } from "./mutations";
import { checkAnchor } from "./threads";
import { compare, fail, uuid, page } from "./store";
import type { Id } from "@quire/contracts";
import { acceptance, decisionId, decisionPlan } from "./decisions";
import type { DecisionPlan } from "./decisions";
import { notifyReview } from "./notifications";

export function registerSuggestions(context: ModuleContext, store: ReviewMutations): void {
  context.routes.register(endpoints.suggestionsList, async (input, request) => {
    const scope = { projectId: input.params.p, branch: input.query.branch };
    await store.read(request, scope);
    const rows = await context.db.all<{ id: Id }>(
      "SELECT id FROM suggestions WHERE project_id=? AND branch=? ORDER BY created_at,id",
      [scope.projectId, scope.branch]);
    const suggestions = await Promise.all(rows.map(async row => (await store.suggestion(row.id, scope.projectId)).dto));
    return page(suggestions.filter(suggestion => suggestion.edits.some(edit =>
      (!input.query.fileId || edit.fileId === input.query.fileId)
      && (!input.query.status || input.query.status === "all" || edit.status === input.query.status))), input.query);
  });
  context.routes.register(endpoints.suggestionCreate, async (input, request) => {
    const scope = (await store.scope(input.params.p, input.body.scope));
    const actorId = await store.write(request, scope, "suggestion.create");
    if (!(await store.projects.policy(actorId, scope.projectId)).trackChanges) fail("TRACKING_DISABLED", 403, "Tracked changes are disabled");
    return store.mutate({ actorId, request, scope, route: "suggestionCreate", body: input, schema: SuggestionSchema, work: async boundStore => {
      const boundContext = boundStore.context;
      compare((await boundStore.projects.getBranch(scope)).revision, input.body.expectedVersion);
      if (!input.body.edits.length) fail("EMPTY_SELECTION", 400, "At least one edit is required");
      for (const edit of input.body.edits) {
        if (edit.fileId !== edit.anchor.fileId || edit.before !== edit.anchor.quote
          || edit.baseRevision > (await boundStore.projects.getBranch(scope)).revision) fail("ANCHOR_CONFLICT", 409, "Edit and anchor differ");
        (await checkAnchor(boundStore, scope, edit.anchor));
      }
      const id = uuid();
      (await boundContext.db.run("INSERT INTO suggestions(id,project_id,branch,author_id,origin,created_at) VALUES(?,?,?,?,'human',?)", [id, scope.projectId, scope.branch, actorId, boundContext.clock.now()]));
      for (const [editOrder, edit] of input.body.edits.entries()) await boundContext.db.run(`INSERT INTO suggestion_edits
        (id,suggestion_id,file_id,anchor_json,before_text,after_text,base_revision,edit_order) VALUES(?,?,?,?,?,?,?,?)`, [uuid(), id, edit.fileId, JSON.stringify(edit.anchor), edit.before, edit.after, edit.baseRevision, editOrder]);
      boundStore.version(request, 0);
      const suggestion = (await boundStore.suggestion(id, scope.projectId)).dto;
      (await notifyReview(boundStore, { type: "suggestion", suggestion, actorId, eventId: `suggestion:${id}:created` }));
      return suggestion;
    } });
  });
  context.routes.register(endpoints.suggestionDecide, async (input, request) => {
    if (!input.body.ids.length || new Set(input.body.ids).size !== input.body.ids.length) fail("EMPTY_SELECTION", 400, "Select distinct suggestions");
    const suggestions = await Promise.all(input.body.ids.map(id => store.suggestion(id, input.params.p)));
    const first = suggestions[0];
    if (!first) fail("EMPTY_SELECTION", 400, "Select suggestions");
    const scope = first.dto.scope;
    if (suggestions.some(item => item.dto.scope.branch !== scope.branch)) fail("SCOPE_MISMATCH", 400, "Suggestions span branches");
    const actorId = await store.write(request, scope, "suggestion.decide");
    const key = request.request.headers.get("idempotency-key");
    if (!key) fail("IDEMPOTENCY_KEY_REQUIRED", 400, "Idempotency-Key required");
    const route = `suggestionDecide:${scope.projectId}:${scope.branch}`;
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex");
    const cachedResult = async () => {
      const cached = await context.db.get<{ request_digest: string; response_json: string }>(
        "SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?", [actorId, key, route]);
      if (!cached) return null;
      if (cached.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Decision key has different input");
      return z.array(SuggestionSchema).parse(JSON.parse(cached.response_json));
    };
    const cached = await cachedResult();
    if (cached) return cached;
    const prepared = await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const bound = store.withTransaction(tx);
      await bound.assertSession(request.request, actorId, scope);
      await bound.projects.authorize(actorId, scope, "suggestion.decide");
      const completed = await tx.get<{ request_digest: string; response_json: string }>(
        "SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?", [actorId, key, route]);
      if (completed) {
        if (completed.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Decision key has different input");
        return { result: z.array(SuggestionSchema).parse(JSON.parse(completed.response_json)) };
      }
      const existing = await tx.get<{ payload_json: string }>("SELECT payload_json FROM review_decision_intents WHERE id=?", [`${actorId}:${route}:${key}`]);
      if (existing) {
        const plan = decisionPlan.parse(JSON.parse(existing.payload_json));
        if (plan.digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Decision key has different input");
        const edits = plan.edits ?? (await Promise.all(plan.ids.map(async id => (await bound.suggestion(id, scope.projectId)).dto.edits))).flat().filter(edit => plan.editIds.includes(edit.id));
        return { plan, edits };
      }
      for (const row of await tx.all<{ payload_json: string }>("SELECT payload_json FROM review_decision_intents")) {
        const other = decisionPlan.parse(JSON.parse(row.payload_json));
        if (other.ids.some(id => input.body.ids.includes(id))) fail("DECISION_BUSY", 409, "Another durable decision owns this suggestion");
      }
      compare((await bound.projects.getBranch(scope)).revision, input.body.expectedVersion);
      const current = await Promise.all(input.body.ids.map(id => bound.suggestion(id, scope.projectId)));
      const edits = current.flatMap(item => item.dto.edits).filter(edit => !input.body.editIds || input.body.editIds.includes(edit.id));
      if (!edits.length || input.body.editIds?.some(id => !edits.some(edit => edit.id === id))) fail("EMPTY_SELECTION", 400, "Unknown selected edit");
      if (edits.some(edit => edit.status !== "pending")) fail("ALREADY_DECIDED", 409, "Selected edit is already decided");
      const plan: DecisionPlan = { actorId, scope, ids: [...input.body.ids], editIds: edits.map(edit => edit.id), key, route, digest, sourceKey: `review-decision:${key}:${digest}` };
      if (input.body.decision === "accept") {
        const finalization = await acceptance(bound, plan, edits);
        await tx.run("INSERT INTO review_decision_intents(id,payload_json) VALUES(?,?)", [decisionId(plan), JSON.stringify({ ...plan, finalization, edits })]);
        return { plan: { ...plan, finalization, edits: [...edits] }, edits };
      }
      return { plan, edits };
    });
    if ("result" in prepared) return prepared.result;
    let conflicts: readonly string[] = [];
    switch (input.body.decision) {
      case "accept": {
        const applied = await store.projects.applyEdits(actorId, scope, prepared.edits, prepared.plan.sourceKey, prepared.plan.finalization);
        conflicts = applied.conflicts;
        if (!conflicts.length) {
          const result = await cachedResult();
          if (!result) fail("DECISION_RECEIPT_MISSING", 500, "Atomic source decision has no receipt");
          return result;
        }
        break;
      }
      case "reject": break;
      default: assertNever(input.body.decision);
    }
    return store.projects.serialized(scope, async lease => {
      const result = await context.uow.run(async tx => {
        await tx.lock("quire:accounts");
        await context.branches.assert(tx, lease);
        const bound = store.withTransaction(tx);
        await bound.assertSession(request.request, actorId, scope);
        await bound.projects.authorize(actorId, scope, "suggestion.decide");
        const completed = await tx.get<{ request_digest: string; response_json: string }>("SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?", [actorId, key, route]);
        if (completed) {
          if (completed.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Decision key has different input");
          return z.array(SuggestionSchema).parse(JSON.parse(completed.response_json));
        }
        for (const row of await tx.all<{ payload_json: string }>("SELECT payload_json FROM review_decision_intents")) {
          const other = decisionPlan.parse(JSON.parse(row.payload_json));
          if (decisionId(other) !== decisionId(prepared.plan) && other.ids.some(id => input.body.ids.includes(id))) fail("DECISION_BUSY", 409, "Another durable decision owns this suggestion");
        }
        for (const edit of prepared.edits) {
          const status = conflicts.length ? (conflicts.includes(edit.id) ? "conflict" : "pending") : "rejected";
          if ((await tx.run("UPDATE suggestion_edits SET status=?,version=version+1 WHERE id=? AND status='pending'", [status, edit.id])).changes !== 1) fail("ALREADY_DECIDED", 409, "Selected edit already decided");
        }
        for (const id of input.body.ids) await tx.run("UPDATE suggestions SET version=version+1 WHERE id=?", [id]);
        const dtos = await Promise.all(input.body.ids.map(async id => (await bound.suggestion(id, scope.projectId)).dto));
        for (const suggestion of dtos) await notifyReview(bound, { type: "suggestion", suggestion, actorId, eventId: `suggestion:${suggestion.id}:decision:${actorId}:${key}` });
        await tx.run("INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at) VALUES(?,?,?,?,200,?,?)", [actorId, key, route, digest, JSON.stringify(dtos), context.clock.now()]);
        await tx.run("DELETE FROM review_decision_intents WHERE id=?", [decisionId(prepared.plan)]);
        await bound.changed(scope);
        return dtos;
      });
      await context.events.dispatch();
      return result;
    });
  });
}
