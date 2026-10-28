import { IdSchema } from "@quire/contracts";
import type { CompilerService } from "./service";

/** Exclusive admission has drained local work; fence remote callbacks without waiting on them. */
export async function quiesceCompilerJobs(service: CompilerService,
  options: { readonly dispatch?: "after-exclusive" | "deferred" } = {},
): Promise<void> {
  const { context } = service;
  await context.uow.run(async tx => {
    await tx.lock("quire:compiler");
    const store = service.store.withTransaction(tx);
    const rows = await tx.all<{ id: string }>(
      "SELECT id FROM compile_jobs WHERE status IN ('queued','running') ORDER BY queue_order");
    for (const row of rows) {
      const id = IdSchema.parse(row.id);
      const job = await store.get(id);
      await tx.run("UPDATE compile_jobs SET fencing_token=fencing_token+1 WHERE id=?", [id]);
      await tx.run("DELETE FROM worker_leases WHERE job_id=?", [id]);
      await tx.run("UPDATE workers SET state='offline',job_id=NULL WHERE job_id=?", [id]);
      const canceled = { ...job, status: "canceled" as const, finishedAt: context.clock.now(), failureCode: "BACKUP_QUIESCED" };
      await store.save(tx, canceled);
      await store.changed(tx, canceled);
    }
  });
  // Dispatch after exclusive admission reopens; do not wait on callbacks inside backup.
  if (options.dispatch !== "deferred") {
    void service.task(context.admission.background(() => context.events.dispatch()));
  }
}
