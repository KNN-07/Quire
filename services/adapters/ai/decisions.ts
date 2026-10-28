import { z } from "zod";
import * as Y from "yjs";
import { AiRunSchema, GitOidSchema, IdSchema, assertNever } from "@quire/contracts";
import type { AiRun, Id, ProposedEdit, Scope, RepositoryRefUpdate } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { GitRepository } from "../../core/git";
import { branchName, raw } from "../../core/git/process";
import type { AiStore } from "./store";
import { AiJournal } from "./journal";
import { applyProposal } from "./proposals";
import { scopeOf, digest, newId, UndoSchema } from "./model";
import type { Actor, RunRecord } from "./model";

export type Decision = {
  readonly id: Id; readonly editIds: readonly Id[]; readonly decision: "accept" | "reject" | "undo";
  readonly expectedVersion: number; readonly key: string; readonly commit?: boolean | undefined; readonly newBranch?: string | undefined;
};
export class AiDecisions {
  readonly journal: AiJournal;
  constructor(readonly store: AiStore) { this.journal = new AiJournal(store); }
  async decide(actor: Actor, input: Decision): Promise<AiRun> {
    const run = await this.store.accessible(actor, input.id);
    const scope = scopeOf(run);
    await this.store.authorize(actor, { scope, mode: "agent" });
    await this.store.core().authorize(actor.id, scope, "write");
    const hash = digest(JSON.stringify(input));
    const cached = await this.store.context.db.get<{ request_digest: string; response_json: string }>(
      "SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?",
    [actor.id, input.key, `aiDecision:${run.id}`]);
    if (cached) {
      if (cached.request_digest !== hash) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Decision key changed");
      return AiRunSchema.parse(JSON.parse(cached.response_json));
    }
    if (run.status !== "succeeded" || run.mode !== "agent") throw new ServiceError("AI_PROPOSALS_UNAVAILABLE", 409, "No completed Agent proposal");
    if (run.version !== input.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "AI run changed");
    if (await this.store.context.db.get("SELECT 1 FROM ai_source_journal WHERE run_id=?", [run.id])) throw new ServiceError("AI_DECISION_BUSY", 409, "Durable AI decision awaits recovery");
    const dto = this.store.dto(run);
    const edits = dto.proposals.flatMap(suggestion => suggestion.edits);
    const selected = input.editIds.length ? edits.filter(edit => input.editIds.includes(edit.id)) : edits;
    if (!selected.length || new Set(input.editIds).size !== input.editIds.length || input.editIds.some(id => !selected.some(edit => edit.id === id))) {
      throw new ServiceError("AI_EDIT_SELECTION", 400, "Select distinct known edits, or [] for all");
    }
    if (selected.some(edit => edit.status !== (input.decision === "undo" ? "accepted" : "pending"))) throw new ServiceError("AI_ALREADY_DECIDED", 409, "Selected edits cannot receive this decision");
    switch (input.decision) {
      case "reject": return this.metadata(actor, { run, input, hash, selected, status: "rejected" });
      case "accept": case "undo": return this.apply(actor, { run, input, hash, selected });
      default: return assertNever(input.decision);
    }
  }
  private async metadata(actor: Actor, plan: {
    readonly run: RunRecord; readonly input: Decision; readonly hash: string;
    readonly selected: readonly ProposedEdit[]; readonly status: "conflict" | "rejected";
  }) {
    const result = await this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const current = await this.store.record(plan.run.id, tx);
      await this.store.authorize(actor, { scope: scopeOf(current), mode: "agent" }, tx);
      await this.store.core(tx).authorize(actor.id, scopeOf(current), "write");
      if (current.version !== plan.input.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "AI run changed");
      const updated = this.store.dto(current).proposals.map(suggestion => ({ ...suggestion,
        edits: suggestion.edits.map(edit => ({ ...edit, status: plan.selected.some(selected => selected.id === edit.id) ? plan.status : edit.status })) }));
      const next = { ...current, proposals_json: JSON.stringify(updated), version: current.version + 1 };
      await tx.run("UPDATE ai_runs SET proposals_json=?,version=version+1 WHERE id=?", [next.proposals_json, next.id]);
      const dto = this.store.dto(next);
      await tx.run("INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at) VALUES(?,?,?,?,200,?,?)",
        [actor.id, plan.input.key, `aiDecision:${next.id}`, plan.hash, JSON.stringify(dto), this.store.context.clock.now()]);
      await this.store.audit(tx, { actorId: actor.id, targetId: next.id, event: `ai.proposals.${plan.status}` });
      await this.store.context.events.record(tx, { topic: "review.changed", aggregateId: next.project_id,
        payload: { resourceId: next.id, version: next.version } });
      return dto;
    });
    await this.store.context.events.dispatch();
    return result;
  }
  private async apply(actor: Actor, plan: {
    readonly run: RunRecord; readonly input: Decision; readonly hash: string; readonly selected: readonly ProposedEdit[];
  }) {
    const { run, input } = plan;
    const original = scopeOf(run);
    if (input.newBranch && (!input.newBranch.startsWith("ai/") || input.decision === "undo")) throw new ServiceError("AI_BRANCH_INVALID", 400, "New AI branch must start with ai/");
    if (input.newBranch) await branchName(input.newBranch);
    const target: Scope = { ...original, branch: input.newBranch ?? original.branch };
    const core = this.store.core();
    return core.serialized(original, async originalLease => {
      const branch = await core.getBranch(original);
      const row = z.object({ undo_json: z.string(), manifest_json: z.string() }).parse(
        await this.store.context.db.get("SELECT undo_json,manifest_json FROM ai_run_metadata WHERE run_id=?", [run.id]));
      const undo = UndoSchema.parse(JSON.parse(row.undo_json));
      const manifest = z.array(z.object({ id: IdSchema, path: z.string() })).parse(JSON.parse(row.manifest_json));
      const liveFiles = await core.listFiles(original);
      const documents = new Map<Id, Y.Doc>();
      const conflicts: ProposedEdit[] = [];
      try {
        for (const selected of plan.selected) {
          const edit = input.decision === "undo" ? undo[selected.id] : selected;
          if (!edit) throw new ServiceError("AI_UNDO_UNAVAILABLE", 409, "No inverse edit retained");
          const file = liveFiles.find(entry => entry.id === edit.fileId);
          if (!file || !file.editable || file.link || file.version.epoch !== edit.anchor.epoch
            || !manifest.some(entry => entry.id === file.id && entry.path === file.path)) { conflicts.push(selected); continue; }
          let document = documents.get(edit.fileId);
          if (!document) {
            document = new Y.Doc();
            Y.applyUpdate(document, Buffer.from((await core.loadDocument(original, edit.fileId)).state, "base64"));
            documents.set(edit.fileId, document);
          }
          const inverse = applyProposal(document, edit);
          if (!inverse) conflicts.push(selected);
          else undo[selected.id] = inverse;
        }
        if (conflicts.length) return this.metadata(actor, { ...plan, selected: conflicts, status: "conflict" });
        const repo = new GitRepository(core);
        const state = input.newBranch || input.commit ? await repo.inspect(actor.id, original, originalLease) : null;
        if (state?.hunks.length) throw new ServiceError("AI_DIRTY_BRANCH", 409, "Commit existing source changes before creating an AI branch or commit");
        const head = state?.head ?? null;
        const lease = input.newBranch ? await this.store.context.branches.acquire(target, crypto.randomUUID(), 60_000) : originalLease;
        if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "AI target branch busy");
        try {
          if (input.newBranch && await this.store.context.db.get("SELECT 1 FROM branch_workspaces WHERE project_id=? AND branch=?", [target.projectId, target.branch])) throw new ServiceError("BRANCH_EXISTS", 409, "AI branch already exists");
          const sourceFiles = await core.listFiles(original);
          if (input.newBranch) for (const file of sourceFiles) {
            if (!file.editable || documents.has(file.id)) continue;
            const document = new Y.Doc();
            Y.applyUpdate(document, Buffer.from((await core.loadDocument(original, file.id)).state, "base64"));
            documents.set(file.id, document);
          }
          const source = await core.prepareSource({ actorId: actor.id, scope: target, lease,
            expectedRevision: input.newBranch ? 0 : branch.revision, ...(input.newBranch ? { newBranchId: newId() } : {}),
            reason: input.commit ? "commit" : "checkpoint",
            inputs: sourceFiles.map(file => {
              const document = documents.get(file.id);
              return { file, ...(document ? { document } : {}) };
            }) });
          const updates: RepositoryRefUpdate[] = [{ ref: `refs/quire/history/${source.snapshot.id}`, expected: null,
            next: GitOidSchema.parse(`sha1:${source.commit}`) }];
          if (head && (input.newBranch || input.commit)) {
            const commit = input.commit ? await repo.commitTree(actor.id, { scope: target, tree: raw(source.snapshot.tree),
              parents: [head], message: `Apply reviewed AI proposal ${run.id}` }) : head;
            updates.push({ ref: `refs/heads/${target.branch}`, expected: input.newBranch ? null : GitOidSchema.parse(`sha1:${head}`),
              next: GitOidSchema.parse(`sha1:${commit}`) });
          }
          const proposals = this.store.dto(run).proposals.map(suggestion => ({ ...suggestion, scope: target,
            edits: suggestion.edits.map(edit => ({ ...edit, status: plan.selected.some(item => item.id === edit.id)
              ? input.decision === "undo" ? "rejected" as const : "accepted" as const : edit.status })) }));
          const payload = { source, runId: run.id, actorId: actor.id, sessionId: actor.sessionId,
            expectedVersion: input.expectedVersion, key: input.key, digest: plan.hash, proposals, undo, updates };
          await this.journal.stage(source.snapshot.id, payload);
          await this.store.context.repositories.publish({ id: source.snapshot.id, lease, updates });
          await this.store.context.uow.run(async tx => {
            await tx.lock("quire:accounts");
            await this.journal.finalize(tx, { id: source.snapshot.id, lease, payload });
          });
          await this.store.context.events.dispatch();
          return this.store.dto(await this.store.record(run.id));
        } finally { if (input.newBranch) await this.store.context.branches.release(lease); }
      } finally { for (const document of documents.values()) document.destroy(); }
    });
  }
}
