import { z } from "zod";
import { IdSchema, resourceVersionTag } from "@quire/contracts";
import type { Transaction, Snapshot, FileEntry } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { BaseStore, fail } from "./store";

export type TransactionContext = Omit<ModuleContext, "db"> & { readonly db: Transaction };
export const receiptKey = z.object({
  actorId: IdSchema, key: z.string(), route: z.string(), digest: z.string(),
});
export type HttpReceipt = z.infer<typeof receiptKey>;
export const sourceReceipt = receiptKey.extend({ response: z.string() });
export type SourceReceipt = z.infer<typeof sourceReceipt>;
export const httpSourceReceipt = receiptKey.extend({
  result: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("project") }),
    z.object({ kind: z.literal("file"), id: IdSchema }),
    z.object({ kind: z.literal("files"), ids: z.array(IdSchema) }),
  ]),
});
export type HttpSourceReceipt = z.infer<typeof httpSourceReceipt>;

export async function saveHttp(context: TransactionContext, receipt: HttpReceipt | undefined,
  data: unknown, version: number | null): Promise<void> {
  if (receipt) await saveReceipt(context, {
    ...receipt,
    response: JSON.stringify({ data, etag: version === null ? null : resourceVersionTag(version) })
  });
}

export async function saveReceipt(context: TransactionContext, receipt: SourceReceipt): Promise<void> {
  const prior = await context.db.get<{ request_digest: string; response_json: string }>(
    "SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?",
    [receipt.actorId, receipt.key, receipt.route]);
  if (prior) {
    if (prior.request_digest !== receipt.digest || prior.response_json !== receipt.response) {
      fail("IDEMPOTENCY_CONFLICT", 409, "Receipt differs from the finalized operation");
    }
    return;
  }
  await context.db.run(`INSERT INTO idempotency_results
    (actor_id,key,route,request_digest,status,response_json,created_at) VALUES(?,?,?,?,200,?,?)`,
    [receipt.actorId, receipt.key, receipt.route, receipt.digest, receipt.response, context.clock.now()]);
}

export async function saveSourceHttpReceipt(context: TransactionContext, input: {
  readonly receipt: HttpSourceReceipt;
  readonly snapshot: Snapshot;
  readonly files: readonly FileEntry[];
}): Promise<void> {
  const { receipt, snapshot, files } = input;
  const store = new BaseStore(context);
  const project = await store.getProject(snapshot.scope.projectId);
  const data = receipt.result.kind === "project" ? project
    : receipt.result.kind === "file" ? files.find(file => receipt.result.kind === "file" && file.id === receipt.result.id)
      : (await store.listFiles(snapshot.scope)).filter(file => receipt.result.kind === "files" && receipt.result.ids.includes(file.id));
  if (data === undefined) fail("SOURCE_RECEIPT_INVALID", 500, "Finalized source result is missing");
  await saveReceipt(context, {
    ...receipt, response: JSON.stringify({
      data, etag: resourceVersionTag(receipt.result.kind === "project" ? project.version : snapshot.revision),
    })
  });
}
