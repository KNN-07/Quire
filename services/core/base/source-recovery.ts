import { z } from "zod";
import { GitOidSchema } from "@quire/contracts";
import type { BranchLease } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { sourceIntent, validateSource, finalizeSource } from "./source-records";
import type { SourceIntent } from "./source-records";

export async function publishSource(context: ModuleContext, intent: SourceIntent, lease: BranchLease): Promise<void> {
  const existing = await context.db.get("SELECT id FROM repository_intents WHERE id=?", [intent.snapshot.id]);
  if (existing) await context.repositories.recover(intent.snapshot.id, lease);
  else await context.repositories.publish({
    id: intent.snapshot.id, lease, updates: [{
      ref: `refs/quire/history/${intent.snapshot.id}`, expected: null,
      next: GitOidSchema.parse(`sha1:${intent.commit}`),
    }]
  });
  await context.uow.run(tx => finalizeSource({ ...context, db: tx }, intent, lease));
  await context.events.dispatch();
}

export async function recoverBranch(context: ModuleContext, lease: BranchLease): Promise<void> {
  const rows = await context.db.query(`SELECT s.payload_json FROM base_source_intents s
    JOIN git_intents g ON g.id=s.id WHERE g.project_id=? AND g.branch=? ORDER BY g.created_at,g.id`,
    [lease.scope.projectId, lease.scope.branch], z.object({ payload_json: z.string() }));
  for (const row of rows) {
    const intent = sourceIntent.parse(JSON.parse(row.payload_json));
    await context.uow.run(async tx => {
      await validateSource({ ...context, db: tx }, intent, lease);
      await tx.run("UPDATE base_source_intents SET owner=?,fence=? WHERE id=?",
        [lease.owner, lease.fence, intent.snapshot.id]);
    });
    await publishSource(context, intent, lease);
  }
}
