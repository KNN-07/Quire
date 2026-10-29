import type { Transaction } from "@quire/contracts";
import { z } from "zod";
import { SecretBox } from "../shared/secrets";
import type { AiOperatorPolicy } from "../shared/provider-policy";
import type { CreateRun, RunRecord } from "./model";
import type { AiStore } from "./store";

/** Optional operator audit, separate from mandatory usage, receipts and reviewed edits. */
export async function logDispatch(store: AiStore, tx: Transaction, run: RunRecord, request: CreateRun, policy: AiOperatorPolicy) {
  if (policy.requestLogging === "off") return;
  const retained = request.mode === "agent" || request.conversationId !== undefined;
  const content = policy.requestLogging === "retained-content" && retained
    ? new SecretBox(store.context.secretKey).seal(JSON.stringify({ prompt: request.prompt }), `ai-log:${run.id}`) : null;
  const now = store.context.clock.now();
  await tx.run(`INSERT INTO ai_request_logs(run_id,policy_version,tool,mode,status,encrypted_content,created_at,updated_at)
    VALUES(?,?,?,?,'running',?,?,?)`, [run.id, policy.version, request.tool, request.mode, content, now, now]);
}

export async function logResult(store: AiStore, tx: Transaction, run: RunRecord, answer: string) {
  const row = await tx.get<{ encrypted_content: Uint8Array | null }>("SELECT encrypted_content FROM ai_request_logs WHERE run_id=?", [run.id]);
  if (!row) return;
  // Use the admitted retention choice. Never log private Ask or selected file/image/diagnostic context.
  const box = new SecretBox(store.context.secretKey);
  const content = row.encrypted_content ? box.seal(JSON.stringify({
    ...z.object({ prompt: z.string() }).parse(JSON.parse(box.open(row.encrypted_content, `ai-log:${run.id}`))), response: answer,
  }), `ai-log:${run.id}`) : null;
  await tx.run("UPDATE ai_request_logs SET status='succeeded',encrypted_content=?,updated_at=? WHERE run_id=?",
    [content, store.context.clock.now(), run.id]);
}
