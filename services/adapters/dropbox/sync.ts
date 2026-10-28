import { GitOidSchema, IdSchema } from "@quire/contracts";
import type { BranchLease, Id, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects } from "../../core/base";
import type { SourceIntent } from "../../core/base";
import type { AdapterServices, ActionContext, PreparedAction } from "../shared";
import { DropboxApi, DropboxError } from "./api";
import type { DropboxEndpoints } from "./api";
import { DropboxPolicies } from "./policy";
import { DropboxStore } from "./journal";
import type { SyncJournal } from "./journal";
import { mergeSources } from "./merge";
import type { SyncTransport } from "./merge";
import { exportGenerated } from "./generated";
import { rebasePrepared } from "./rebase";
import { contentHash } from "./model";
import type { SyncParameters, SyncState } from "./model";

export class DropboxSync {
  readonly store: DropboxStore;
  readonly policies: DropboxPolicies;
  constructor(readonly services: AdapterServices, readonly endpoints: DropboxEndpoints) {
    this.store = new DropboxStore(services); this.policies = new DropboxPolicies(services.context);
  }
  async prepare(input: {
    readonly action: "initialSync" | "sync"; readonly parameters: SyncParameters; readonly context: ActionContext;
  }): Promise<PreparedAction> {
    const { context } = input;
    if (!context.projectId) throw new ServiceError("PROJECT_REQUIRED", 400, "Dropbox requires a project");
    const projectId = context.projectId;
    await this.policies.assert(context.actorId, projectId);
    const saved = await this.store.read(context.grant.id, projectId);
    if (input.action === "sync" && (!saved || !saved.enabled)) {
      throw new ServiceError("DROPBOX_NOT_CONNECTED", 409, "Run initialSync for this project");
    }
    if (input.action === "initialSync" && saved?.enabled) {
      throw new ServiceError("DROPBOX_ALREADY_CONNECTED", 409, "Project already connected; use sync");
    }
    const retry = await this.services.context.db.get<{ retry_at: string }>(
      "SELECT retry_at FROM dropbox_retries WHERE grant_id=? AND project_id=?", [context.grant.id, projectId]);
    if (retry && retry.retry_at > this.services.context.clock.now()) {
      throw new ServiceError("DROPBOX_RETRY_AFTER", 409, `Retry Dropbox after ${retry.retry_at}`);
    }
    const projects = new CoreProjects(this.services.context);
    const project = await projects.getProject(projectId);
    const branch = input.parameters.branch ?? project.defaultBranch;
    if (saved && saved.state.branch !== branch) throw new ServiceError("DROPBOX_BRANCH_CONFLICT", 409, "Disconnect before changing synchronized branch");
    const scope = { projectId, branch };
    const lease = await this.services.context.branches.acquire(scope, crypto.randomUUID(), 150_000);
    if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "Project branch has an active writer");
    const release = () => this.services.context.branches.release(lease);
    try {
      const pending = await this.store.pending(context.grant.id, projectId);
      if (pending && pending.actorId !== context.actorId) {
        throw new ServiceError("DROPBOX_RECOVERY_AUTHORITY_CHANGED", 409, "Pending recovery belongs to another actor");
      }
      if (pending?.state) return await this.publication({ context, projectId, lease, journal: pending });
      const api = new DropboxApi(this.services.http, this.endpoints, context);
      const state: SyncState = saved?.state ?? { branch, cursor: null, generated: false, files: [], remote: [], conflicts: [] };
      const listed = await api.list({ root: "", cursor: state.cursor, remote: state.remote });
      const files = await projects.listFiles(scope);
      const current = await projects.getBranch(scope);
      const userState = await this.services.context.db.get<{ state: string }>(
        "SELECT state FROM project_user_state WHERE project_id=? AND user_id=?", [projectId, context.actorId]);
      if (userState?.state === "trash") throw new ServiceError("DROPBOX_PROJECT_TRASHED", 409, "Restore project before synchronizing");
      let work: SyncJournal = { actorId: context.actorId, grantVersion: context.grant.version,
        configVersion: context.configuration.version, key: pending?.key ?? context.key, action: pending?.action ?? input.action,
        parameters: { branch, generatedOutput: input.parameters.generatedOutput },
        source: null, state: null, archived: userState?.state === "archived",
        writes: pending?.writes ?? [] };
      const save = () => this.store.save({ context, projectId, journal: work });
      await save();
      const authorize = async () => {
        await this.policies.assert(context.actorId, projectId);
        const active = await this.services.grants.credentials(context.actorId, context.grant.id);
        const config = await this.services.configuration.get("dropbox");
        if (active.grant.version !== context.grant.version || config.version !== context.configuration.version) {
          throw new ServiceError("DROPBOX_AUTHORITY_CHANGED", 409, "Dropbox grant or provider changed before dispatch");
        }
      };
      const transport: SyncTransport = {
          download: file => api.download(file),
          upload: async upload => {
            work = { ...work, writes: [...work.writes, { path: upload.path, revision: upload.previous?.rev ?? null, hash: contentHash(upload.bytes) }] };
            await save();
            await authorize();
            return api.upload(upload);
          },
          delete: async file => {
            work = { ...work, writes: [...work.writes, { path: file.path_display, revision: file.rev, hash: null }] };
            await save(); await authorize(); await api.delete(file);
          },
        };
      const merged = await mergeSources({
        workspace: { projectId, mainId: project.settings.mainFileId, files, archived: userState?.state === "archived" },
        state, remote: listed.files,
      }, { blobs: this.services.context.blobs, transport });
      const remote = input.parameters.generatedOutput ? await exportGenerated({
        context: this.services.context, projectId, branch, remote: merged.remote, transport,
      }) : merged.remote;
      const next: SyncState = { branch, cursor: listed.cursor, generated: input.parameters.generatedOutput,
        files: merged.files, remote: [...remote], conflicts: merged.conflicts };
      const source = merged.changed ? await projects.prepareSource({ actorId: context.actorId, scope, lease,
        expectedRevision: current.revision, inputs: merged.inputs, reason: "import" }) : null;
      work = { ...work, source, state: next };
      await save();
      return await this.publication({ context, projectId, lease, journal: work });
    } catch (error) {
      await release();
      if (error instanceof DropboxError && error.remoteStatus === 429) {
        await this.services.context.db.run(`INSERT INTO dropbox_retries(grant_id,project_id,retry_at) VALUES(?,?,?)
          ON CONFLICT(grant_id,project_id) DO UPDATE SET retry_at=excluded.retry_at`,
        [context.grant.id, projectId, new Date(Date.parse(this.services.context.clock.now()) + error.retryAfter * 1000).toISOString()]);
      }
      throw error;
    }
  }
  private async publication(input: {
    readonly context: ActionContext; readonly projectId: Id; readonly lease: BranchLease; readonly journal: SyncJournal;
  }): Promise<PreparedAction> {
    const { context, projectId, lease } = input;
    const journal = await rebasePrepared({ ...input, store: this.store });
    const state = journal.state;
    if (!state) throw new ServiceError("DROPBOX_JOURNAL_INVALID", 500, "Prepared state missing");
    const source = journal.source;
    if (source) {
      const existing = await this.services.context.db.get("SELECT id FROM repository_intents WHERE id=?", [source.snapshot.id]);
      if (existing) await this.services.context.repositories.recover(source.snapshot.id, lease);
      else await this.services.context.repositories.publish({ id: source.snapshot.id, lease, updates: [{
        ref: `refs/quire/history/${source.snapshot.id}`, expected: null, next: GitOidSchema.parse(`sha1:${source.commit}`),
      }] });
    }
    const result = { cursor: state.cursor, conflicts: state.conflicts, recovered: journal.key !== context.key,
      generatedOutput: state.generated, projectId };
    return {
      result, cursor: state.cursor, release: () => this.services.context.branches.release(lease),
      publish: async tx => {
        await this.policies.assert(context.actorId, projectId, tx);
        const userState = await tx.get<{ state: string }>(
          "SELECT state FROM project_user_state WHERE project_id=? AND user_id=?", [projectId, context.actorId]);
        if (userState?.state === "trash" || (userState?.state === "archived") !== journal.archived) {
          throw new ServiceError("DROPBOX_ARCHIVE_CHANGED", 409, "Project archive state changed during synchronization");
        }
        if (source) await this.finalize(tx, { source, lease });
        else await this.services.context.branches.assert(tx, lease);
        await this.store.finish(tx, { grantId: context.grant.id, projectId, state });
        if (journal.key !== context.key) await this.reconcileReceipt(tx, { context, projectId, journal, result });
      },
    };
  }
  private async finalize(tx: Transaction, input: { readonly source: SourceIntent; readonly lease: BranchLease }) {
    const projects = new CoreProjects(this.services.context);
    const events = await projects.finalizePreparedSources(tx, {
      publication: { id: input.source.snapshot.id, lease: input.lease }, sources: [input],
    });
    for (const event of events) await this.services.context.events.record(tx, event);
  }
  private async reconcileReceipt(tx: Transaction, input: {
    readonly context: ActionContext; readonly projectId: Id; readonly journal: SyncJournal;
    readonly result: Readonly<Record<string, unknown>>;
  }) {
    const row = await tx.get<{ id: string }>("SELECT id FROM operations WHERE actor_id=? AND idempotency_key=?",
      [input.journal.actorId, input.journal.key]);
    if (!row) throw new ServiceError("DROPBOX_RECEIPT_MISSING", 409, "Recovery operation receipt missing");
    await tx.run("UPDATE operations SET status='succeeded',progress=1,error_code=NULL,result_json=?,version=version+1,updated_at=? WHERE id=?",
      [JSON.stringify(input.result), this.services.context.clock.now(), row.id]);
    await this.services.context.events.record(tx, { topic: "operation.changed", aggregateId: IdSchema.parse(row.id),
      payload: { resourceId: IdSchema.parse(row.id), status: "succeeded" } });
  }
}
