import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { AiStore } from "./store";
import type { AiConversations } from "./conversations";
import type { OpenAiChat } from "./provider";
import type { PublicationRetrieval, RetrievedPublication } from "../references";
import { RetrievalProviderSchema } from "../references";
import { actorOf, scopeOf, digest, newId } from "./model";
import type { CreateRun, RunContext, RunRecord } from "./model";
import { checkContextSize } from "./context";
import { proposals } from "./proposals";
import { logDispatch, logResult } from "./request-log";
import { claimFindings, currentClaimContext } from "./findings";
import { ProjectSearch } from "./project-search";

export type Execution = {
  readonly run: RunRecord; readonly request: CreateRun; readonly selected: RunContext; readonly signal: AbortSignal;
};
export class AiExecution {
  constructor(readonly store: AiStore, readonly conversations: AiConversations, readonly provider: OpenAiChat) {}
  retrieval: PublicationRetrieval | undefined;
  async execute(input: Execution) {
    const { run, request, selected, signal } = input;
    const actor = actorOf(run);
    const authority = await this.store.recheck(run);
    const history = await this.conversations.history(actor, request);
    const retrieved: RetrievedPublication[] = [];
    if (request.tool === "citation-reviewer") {
      if (!this.retrieval) throw new ServiceError("AI_RETRIEVAL_UNCONFIGURED", 503, "Missing: configured PublicationRetrieval factory");
      if (!authority.preferences.citationWebSearch || !authority.preferences.citationProviders.length) {
        throw new ServiceError("AI_RETRIEVAL_CONSENT", 403, "Enable citation web search and explicitly select retrieval providers");
      }
      await this.store.progress(run.id, undefined, "retrieval");
      for (const name of authority.preferences.citationProviders) {
        // Retrieval discloses a prompt too; fence every outbound provider, not only inference.
        const checked = await this.store.recheck(run);
        if (!checked.preferences.citationWebSearch || !checked.preferences.citationProviders.includes(name)) {
          throw new ServiceError("AI_RETRIEVAL_CONSENT", 403, "Citation retrieval consent changed");
        }
        signal.throwIfAborted();
        const result = await this.retrieval.search({ actorId: actor.id, projectId: run.project_id,
          provider: RetrievalProviderSchema.parse(name), query: request.prompt, limit: 10, signal });
        retrieved.push(...result.items);
      }
      await this.store.progress(run.id, "succeeded");
    }
    checkContextSize({ prompt: request.prompt, history, files: selected.files.map(file => ({
      id: file.id, path: file.path, text: file.text.slice(file.from, file.to),
    })), diagnostic: selected.diagnostic, publications: retrieved.map(item => item.publication) });
    await this.store.services.http.validate(authority.settings.baseUrl, true);
    signal.throwIfAborted();
    const current = await this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const checked = await this.store.recheck(run, tx);
      if (request.tool === "citation-reviewer") await currentClaimContext(this.store, run, selected.files, tx);
      const row = await this.store.record(run.id, tx);
      if (row.status !== "queued" || signal.aborted) throw new ServiceError("AI_CANCELED", 409, "AI run is no longer queued");
      if (request.conversationId) await this.conversations.get(actor, { id: request.conversationId, projectId: run.project_id }, tx);
      await tx.run("UPDATE ai_usage SET state='dispatched',dispatched_at=? WHERE id=? AND state='reserved'", [this.store.context.clock.now(), run.usage_id]);
      await tx.run("UPDATE ai_runs SET status='running',version=version+1 WHERE id=?", [run.id]);
      await this.store.steps(tx, row, undefined, "provider");
      await logDispatch(this.store, tx, run, request, checked.operatorPolicy);
      await tx.run("UPDATE ai_run_metadata SET context_digest=? WHERE run_id=?", [digest(JSON.stringify({
        prompt: request.prompt, selected: selected.files.map(file => ({ id: file.id, text: file.text.slice(file.from, file.to) })),
        diagnostic: selected.diagnostic, images: selected.images.map(image => digest(Buffer.from(image.bytes).toString("base64"))),
      })), run.id]);
      await this.store.changed(tx, { ...run, status: "running" });
      return checked;
    });
    await this.store.context.events.dispatch();
    const model = current.preferences.aiModel ?? current.settings.model;
    if (!model) throw new ServiceError("AI_UNCONFIGURED", 503, "Missing configured model");
    const search = request.projectSearch ? new ProjectSearch(this.store, run, signal) : undefined;
    const result = await this.provider.complete(current.settings, { request, context: selected, history, model,
      ...(search ? { search } : {}),
      style: current.preferences.aiStyle, publications: retrieved.map(item => item.publication), signal });
    signal.throwIfAborted();
    await this.store.progress(run.id, "succeeded", "validation");
    if (request.mode === "ask" && result.answer.patches.length) throw new ServiceError("AI_READ_ONLY", 502, "Read-only AI may not propose edits");
    const edits = proposals(result.answer, selected.files);
    if (request.tool !== "citation-reviewer" && result.answer.findings.length) {
      throw new ServiceError("AI_FINDING_INVALID", 502, "Claim findings require the citation-reviewer tool");
    }
    const findings = claimFindings(result.answer, selected.files, retrieved.map(item => item.publication));
    const references = [...result.answer.citations, ...findings.flatMap(finding => finding.citations)];
    const sources = references.filter((citation, index) => references.findIndex(item =>
      item.provider === citation.provider && item.providerId === citation.providerId) === index).map(citation => {
      const found = retrieved.find(item => item.publication.provider === citation.provider && item.publication.providerId === citation.providerId);
      if (!found) throw new ServiceError("AI_CITATION_UNVERIFIED", 502, "Citation is not tied to this invocation's retrieval provenance");
      return found;
    });
    const messages = [{ role: "user" as const, text: request.prompt }, { role: "assistant" as const, text: result.answer.text }];
    await this.store.progress(run.id, "succeeded", "publication");
    await this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const checked = await this.store.recheck(run, tx);
      if (search) await search.current(tx);
      if (request.tool === "citation-reviewer" && retrieved.some(item => !checked.preferences.citationProviders.includes(item.publication.provider))) {
        throw new ServiceError("AI_RETRIEVAL_CONSENT", 403, "A retrieved provider is no longer consented");
      }
      if (request.tool === "citation-reviewer") await currentClaimContext(this.store, run, selected.files, tx);
      const latest = await this.store.record(run.id, tx);
      if (latest.status !== "running" || signal.aborted) throw new ServiceError("AI_CANCELED", 409, "Discarding late AI output");
      await this.store.steps(tx, latest, "succeeded");
      await this.conversations.append(tx, run, messages);
      await tx.run(`UPDATE ai_runs SET status='succeeded',messages_json=?,proposals_json=?,sources_json=?,provider_request_id=?,
        version=version+1,updated_at=? WHERE id=?`,
      [JSON.stringify(request.mode === "agent" || request.conversationId ? messages : []),
        JSON.stringify(edits.length ? [{ id: newId(), scope: scopeOf(run), authorId: actor.id, origin: "ai", edits, createdAt: this.store.context.clock.now() }] : []),
        JSON.stringify(sources.map(item => item.publication)), result.providerRequestId, this.store.context.clock.now(), run.id]);
      await tx.run("UPDATE ai_run_metadata SET manifest_json=?,findings_json=? WHERE run_id=?",
        [JSON.stringify([...selected.files.map(file => ({ id: file.id, path: file.path })),
          ...search?.excerpts.map(file => ({ id: file.fileId, path: file.path })) ?? []].filter((file, index, files) =>
          files.findIndex(other => other.id === file.id) === index)),
          JSON.stringify(request.mode === "agent" || request.conversationId ? findings : []), run.id]);
      for (const item of sources) await tx.run("INSERT INTO ai_run_provenance(run_id,provider,provider_id,provenance_json) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
        [run.id, item.publication.provider, item.publication.providerId, JSON.stringify(item.provenance)]);
      await this.store.audit(tx, { actorId: actor.id, targetId: run.id, event: "ai.run.succeeded" });
      await logResult(this.store, tx, run, result.answer.text);
      await this.store.changed(tx, { ...run, status: "succeeded" });
    });
    this.conversations.remember(actor, run, messages, findings);
    await this.store.context.events.dispatch();
  }
  async fail(id: Id, error: unknown) {
    if (!(error instanceof Error)) throw error;
    const code = error instanceof ServiceError ? error.code : error.name === "AbortError" ? "AI_CANCELED" : "AI_EXECUTION_FAILED";
    await this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const run = await this.store.record(id, tx);
      if (run.status !== "queued" && run.status !== "running") return;
      await tx.run("UPDATE ai_usage SET state='refunded',refunded_at=? WHERE id=? AND state='reserved'", [this.store.context.clock.now(), run.usage_id]);
      const canceled = ["AI_CANCELED", "AI_POLICY_DENIED", "AI_CONFIDENTIAL", "AI_CONSENT_REQUIRED", "AI_DISABLED", "UNAUTHENTICATED",
        "AI_CONFIGURATION_CHANGED", "AI_CITATION_POLICY_DENIED", "AI_CONVERSATION_NOT_FOUND", "AI_INLINE_DISABLED",
        "AI_CONTEXT_STALE"].includes(code) || (code === "AI_RETRIEVAL_CONSENT" && run.status === "running");
      const status = canceled ? "canceled" : "failed";
      await tx.run("UPDATE ai_runs SET status=?,version=version+1,updated_at=? WHERE id=?", [status, this.store.context.clock.now(), id]);
      await this.store.steps(tx, run, status);
      await tx.run("UPDATE ai_run_metadata SET error_code=? WHERE run_id=?", [code, id]);
      await tx.run("UPDATE ai_request_logs SET status=?,error_code=?,updated_at=? WHERE run_id=?",
        [status, code, this.store.context.clock.now(), id]);
      await this.store.audit(tx, { actorId: run.actor_id, targetId: id, event: `ai.run.${status}` });
      await this.store.changed(tx, { ...run, status });
    });
    await this.store.context.events.dispatch();
  }
}
