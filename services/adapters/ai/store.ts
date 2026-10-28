import { z } from "zod";
import { AiRunSchema } from "@quire/contracts";
import type { Id, Scope, SqlExecutor, Transaction, AiRun } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects } from "../../core/base";
import { store as identityStore } from "../../accounts/identity/store";
import { intersectPolicy } from "../../accounts/identity/policy";
import type { AdapterServices } from "../shared";
import { missingConfiguration } from "./provider";
import { actorOf, scopeOf, newId, RunRecordSchema, CreateRunSchema } from "./model";
import type { Actor, CreateRun, RunRecord } from "./model";

export class AiStore {
  constructor(readonly services: AdapterServices, readonly termsVersion: string) {}
  get context() { return this.services.context; }
  core(db: SqlExecutor = this.context.db) { return new CoreProjects({ ...this.context, db }); }
  async authorize(actor: Actor, input: Pick<CreateRun, "scope" | "mode">, db: SqlExecutor = this.context.db) {
    const { scope, mode } = input;
    await this.core(db).authorize(actor.id, scope, "read");
    if (!await db.get("SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?",
      [actor.sessionId, actor.id, this.context.clock.now()])) throw new ServiceError("UNAUTHENTICATED", 401, "Active session required");
    const consent = await db.get<{ terms_version: string; accepted: number }>(
      "SELECT terms_version,accepted FROM identity_ai_consent WHERE user_id=?", [actor.id]);
    if (consent?.accepted !== 1 || consent.terms_version !== this.termsVersion) {
      throw new ServiceError("AI_CONSENT_REQUIRED", 403, `Accept AI terms ${this.termsVersion} before sending context`);
    }
    const security = await db.get<{ confidential: number }>("SELECT confidential FROM ai_project_security WHERE project_id=?", [scope.projectId]);
    if (security?.confidential === 1) throw new ServiceError("AI_CONFIDENTIAL", 403, "Confidential project cannot use AI");
    const settings = await this.services.configuration.get("ai", db);
    const missing = missingConfiguration(settings);
    if (missing.length || settings.version === 0) throw new ServiceError("AI_UNCONFIGURED", 503, `Missing: ${missing.join("; ") || "operator AI configuration"}`);
    if (!settings.enabled) throw new ServiceError("AI_DISABLED", 403, "AI provider disabled");
    const policy = intersectPolicy(await this.core(db).policy(actor.id, scope.projectId), settings.policy);
    if (policy.ai === "off" || (mode === "agent" && policy.ai !== "agent")) {
      throw new ServiceError("AI_POLICY_DENIED", 403, "Current user, organization, project or provider policy denies this AI mode");
    }
    return { settings, policy, preferences: await identityStore({ ...this.context, db }).preferences(actor.id, db) };
  }
  async record(id: Id, db: SqlExecutor = this.context.db): Promise<RunRecord> {
    const row = await db.get(`SELECT r.*,m.session_id,m.config_version,m.conversation_id,m.request_json,m.error_code
      FROM ai_runs r JOIN ai_run_metadata m ON m.run_id=r.id WHERE r.id=?`, [id]);
    if (!row) throw new ServiceError("NOT_FOUND", 404, "AI run not found");
    return RunRecordSchema.parse(row);
  }
  async accessible(actor: Actor, id: Id, db: SqlExecutor = this.context.db) {
    const run = await this.record(id, db);
    await this.core(db).authorize(actor.id, scopeOf(run), "read");
    if (run.actor_id !== actor.id || (run.mode === "ask" && !run.conversation_id && run.session_id !== actor.sessionId)) {
      const shared = run.conversation_id && await db.get(
        `SELECT 1 FROM ai_conversations c JOIN ai_conversation_retention r ON r.conversation_id=c.id
         WHERE c.id=? AND c.shared=1 AND r.expires_at>?`, [run.conversation_id, this.context.clock.now()]);
      if (!shared && run.mode !== "agent") throw new ServiceError("NOT_FOUND", 404, "AI run not found in this session");
    }
    return run;
  }
  dto(run: RunRecord, messages?: AiRun["messages"]): AiRun {
    return AiRunSchema.parse({ id: run.id, scope: scopeOf(run), mode: run.mode, status: run.status,
      tool: CreateRunSchema.parse(JSON.parse(run.request_json)).tool, version: run.version,
      errorCode: run.error_code, conversationId: run.conversation_id,
      messages: messages ?? JSON.parse(run.messages_json), proposals: JSON.parse(run.proposals_json),
      sources: JSON.parse(run.sources_json), usageId: run.usage_id });
  }
  async audit(tx: Transaction, input: { readonly actorId: Id; readonly targetId: Id; readonly event: string }) {
    await tx.run("INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json) VALUES(?,?,?,?,?,'{}')",
      [newId(), this.context.clock.now(), input.actorId, input.event, input.targetId]);
  }
  async changed(tx: Transaction, run: RunRecord) {
    await this.context.events.record(tx, { topic: "operation.changed", aggregateId: run.id,
      payload: { resourceId: run.id, status: run.status } });
  }
  async recheck(run: RunRecord, db: SqlExecutor = this.context.db) {
    const request = CreateRunSchema.parse(JSON.parse(run.request_json));
    const authority = await this.authorize(actorOf(run), request, db);
    if (authority.settings.version !== run.config_version) throw new ServiceError("AI_CONFIGURATION_CHANGED", 409, "AI configuration changed");
    if (request.tool === "inline-completion" && !authority.preferences.inlineCompletion) throw new ServiceError("AI_INLINE_DISABLED", 403, "Inline completion disabled");
    if (authority.preferences.aiModel && authority.preferences.aiModel !== authority.settings.model) throw new ServiceError("AI_MODEL_UNCONFIGURED", 409, "Selected model changed");
    return authority;
  }
  async usage(actor: Actor, month: string) {
    z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(month);
    await this.core().readUser(actor.id);
    const rows = await this.context.db.all<{ state: string; n: number }>(
      "SELECT state,count(*) AS n FROM ai_usage WHERE user_id=? AND day LIKE ? GROUP BY state", [actor.id, `${month}-%`]);
    return { month, used: rows.find(row => row.state === "dispatched")?.n ?? 0,
      reserved: rows.find(row => row.state === "reserved")?.n ?? 0, refunded: rows.find(row => row.state === "refunded")?.n ?? 0 };
  }
  async security(actor: Actor, projectId: Id) {
    const project = await this.core().getProject(projectId);
    await this.core().authorize(actor.id, { projectId, branch: project.defaultBranch }, "read");
    const row = await this.context.db.get<{ confidential: number; version: number }>(
      "SELECT confidential,version FROM ai_project_security WHERE project_id=?", [projectId]);
    return { confidential: row?.confidential === 1, version: row?.version ?? 0 };
  }
  async setSecurity(actor: Actor, input: { readonly scope: Scope; readonly confidential: boolean; readonly expectedVersion: number }) {
    const result = await this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await this.core(tx).authorize(actor.id, input.scope, "owner");
      const row = await tx.get<{ version: number }>("SELECT version FROM ai_project_security WHERE project_id=?", [input.scope.projectId]);
      if ((row?.version ?? 0) !== input.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Security label changed");
      const version = input.expectedVersion + 1;
      await tx.run(`INSERT INTO ai_project_security(project_id,confidential,version) VALUES(?,?,?)
        ON CONFLICT(project_id) DO UPDATE SET confidential=excluded.confidential,version=excluded.version`,
      [input.scope.projectId, Number(input.confidential), version]);
      await this.audit(tx, { actorId: actor.id, targetId: input.scope.projectId, event: "ai.security.changed" });
      await this.context.events.record(tx, { topic: "policy.changed", aggregateId: input.scope.projectId,
        payload: { resourceId: input.scope.projectId, version } });
      return { confidential: input.confidential, version };
    });
    await this.context.events.dispatch();
    return result;
  }
}
