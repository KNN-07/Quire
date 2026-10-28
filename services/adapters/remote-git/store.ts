import { z } from "zod";
import { IdSchema, OperationSchema, ProjectSchema } from "@quire/contracts";
import type { Id, Operation, Project, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { PendingEvent } from "@quire/runtime";
import type { AdapterServices } from "../shared";
import { sourceIntent } from "../../core/base";
import type { SourceIntent } from "../../core/base";
import {
  BindingCursorSchema,
  BindingRowSchema,
  RemoteBindingSchema,
  RemoteProviderSchema,
  bindingFromRow,
} from "./types";
import type { BindingCursor, RemoteBinding, RemoteProvider } from "./types";

export const RemoteIntentPayloadSchema = z.strictObject({
  source: sourceIntent,
  project: ProjectSchema.optional(),
  binding: RemoteBindingSchema,
  heads: z.record(z.string(), z.string().regex(/^[0-9a-f]{40}$/)),
  operation: OperationSchema,
  cursor: z.string().nullable(),
}).readonly();
export type RemoteIntentPayload = z.infer<typeof RemoteIntentPayloadSchema>;

const intentRowSchema = z.strictObject({
  id: IdSchema,
  operation_id: IdSchema,
  actor_id: IdSchema,
  grant_id: IdSchema,
  action: z.string(),
  project_id: IdSchema,
  payload_json: z.string(),
  state: z.string(),
  created_at: z.string(),
});

export class RemoteGitStore {
  constructor(private readonly services: AdapterServices) {}

  async binding(input: {
    readonly actorId: Id;
    readonly projectId: Id;
    readonly provider: RemoteProvider;
    readonly grantId: Id;
  }): Promise<RemoteBinding> {
    await this.services.grants.read(input.actorId, input.grantId);
    const row = await this.services.context.db.get(
      "SELECT * FROM remote_bindings WHERE project_id=? AND provider=? AND grant_id=?",
      [input.projectId, input.provider, input.grantId],
    );
    if (!row) throw new ServiceError("REMOTE_BINDING_NOT_FOUND", 404, "Project is not linked to this remote connection");
    return bindingFromRow(BindingRowSchema.parse(row));
  }

  async operation(actorId: Id, key: string): Promise<Operation> {
    const row = await this.services.context.db.get(
      "SELECT id,kind,status,progress,result_json,error_code FROM operations WHERE actor_id=? AND idempotency_key=?",
      [actorId, key],
    );
    if (!row) throw new ServiceError("ADAPTER_RECEIPT_MISSING", 500, "Remote Git action receipt was not admitted");
    const parsed = z.strictObject({
      id: IdSchema,
      kind: z.string(),
      status: z.string(),
      progress: z.number(),
      result_json: z.string().nullable(),
      error_code: z.string().nullable(),
    }).parse(row);
    return OperationSchema.parse({
      id: parsed.id,
      kind: parsed.kind,
      status: parsed.status,
      progress: parsed.progress,
      result: parsed.result_json === null ? null : JSON.parse(parsed.result_json),
      errorCode: parsed.error_code,
    });
  }

  async journal(input: {
    readonly id: Id;
    readonly actorId: Id;
    readonly grantId: Id;
    readonly action: string;
    readonly projectId: Id;
    readonly payload: RemoteIntentPayload;
  }): Promise<void> {
    await this.services.context.uow.run(async (tx) => {
      await tx.lock(`remote-git:${input.projectId}`);
      await tx.run(`INSERT INTO remote_git_intents
        (id,operation_id,actor_id,grant_id,action,project_id,payload_json,state,created_at)
        VALUES(?,?,?,?,?,?,?,'prepared',?)`, [
        input.id,
        input.payload.operation.id,
        input.actorId,
        input.grantId,
        input.action,
        input.projectId,
        JSON.stringify(input.payload),
        this.services.context.clock.now(),
      ]);
    });
  }

  async intents(): Promise<readonly {
    readonly id: Id;
    readonly actorId: Id;
    readonly grantId: Id;
    readonly action: string;
    readonly projectId: Id;
    readonly payload: RemoteIntentPayload;
  }[]> {
    const rows = await this.services.context.db.all(
      "SELECT * FROM remote_git_intents ORDER BY created_at,id",
    );
    return rows.map((value) => {
      const row = intentRowSchema.parse(value);
      return {
        id: row.id,
        actorId: row.actor_id,
        grantId: row.grant_id,
        action: row.action,
        projectId: row.project_id,
        payload: RemoteIntentPayloadSchema.parse(JSON.parse(row.payload_json)),
      };
    });
  }

  async finalizeDomain(tx: Transaction, input: {
    readonly intentId: Id;
    readonly payload: RemoteIntentPayload;
    readonly events: readonly PendingEvent[];
  }): Promise<void> {
    const { binding } = input.payload;
    await tx.run(`INSERT INTO remote_bindings(id,project_id,provider,grant_id,remote_url,branch,cursor,version)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET
      provider=excluded.provider,grant_id=excluded.grant_id,remote_url=excluded.remote_url,
      branch=excluded.branch,cursor=excluded.cursor,version=remote_bindings.version+1`, [
      binding.id,
      binding.projectId,
      binding.provider,
      binding.grantId,
      binding.remoteUrl,
      binding.branch,
      JSON.stringify(binding.cursor),
      binding.version,
    ]);
    for (const [branch, head] of Object.entries(input.payload.heads)) {
      await tx.run(`INSERT INTO branch_heads(project_id,branch,head)
        VALUES(?,?,?) ON CONFLICT(project_id,branch) DO UPDATE SET
        head=excluded.head,version=branch_heads.version+1`, [
        binding.projectId,
        branch,
        `sha1:${head}`,
      ]);
    }
    await tx.run("DELETE FROM remote_git_intents WHERE id=?", [input.intentId]);
    for (const event of input.events) await this.services.context.events.record(tx, event);
  }

  async recoverReceipt(tx: Transaction, payload: RemoteIntentPayload): Promise<void> {
    const { binding, operation } = payload;
    await tx.run(
      "UPDATE operations SET status='succeeded',progress=1,result_json=?,error_code=NULL,version=version+1,updated_at=? WHERE id=?",
      [JSON.stringify(operation.result), this.services.context.clock.now(), operation.id],
    );
    await tx.run(`INSERT INTO adapter_cursors(grant_id,action,project_id,cursor,version,updated_at)
      VALUES(?,?,?,?,1,?) ON CONFLICT(grant_id,action,project_id) DO UPDATE SET
      cursor=excluded.cursor,version=adapter_cursors.version+1,updated_at=excluded.updated_at`, [
      binding.grantId,
      operation.kind.split(".").at(-1) ?? "",
      binding.projectId,
      payload.cursor,
      this.services.context.clock.now(),
    ]);
    await this.services.context.events.record(tx, {
      topic: "operation.changed",
      aggregateId: operation.id,
      payload: { resourceId: operation.id, status: "succeeded" },
    });
  }

  bindingValue(input: {
    readonly id?: Id;
    readonly projectId: Id;
    readonly provider: RemoteProvider;
    readonly grantId: Id;
    readonly remoteUrl: string;
    readonly branch: string;
    readonly cursor: BindingCursor;
    readonly version?: number;
  }): RemoteBinding {
    return RemoteBindingSchema.parse({
      id: input.id ?? IdSchema.parse(crypto.randomUUID()),
      projectId: input.projectId,
      provider: RemoteProviderSchema.parse(input.provider),
      grantId: input.grantId,
      remoteUrl: input.remoteUrl,
      branch: input.branch,
      cursor: BindingCursorSchema.parse(input.cursor),
      version: input.version ?? 1,
    });
  }
}

export type { SourceIntent, Project };
