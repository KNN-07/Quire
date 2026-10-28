import { ServiceError } from "@quire/runtime";
import { assertNever } from "@quire/contracts";
import type { CompileJob, Id, Scope } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { fail } from "../base/store";
import type { GitRepository } from "./repository";
import { treeInputs, hydrate } from "./trees";
import { stableId } from "./process";

/** Retain an immutable private workspace so CompilePort can compile the exact staged tree. */
export async function compileStaged(repo: GitRepository, actorId: Id, input: {
  readonly scope: Scope; readonly tree: string; readonly key: string;
}) {
  const scope = { projectId: input.scope.projectId, branch: `quire-stage-${stableId(`${actorId}:${input.key}:${input.tree}`)}` };
  const context = repo.service.context;
  await repo.service.serialized(scope, async lease => {
    const exists = await context.db.get("SELECT 1 FROM branch_workspaces WHERE project_id=? AND branch=?", [scope.projectId, scope.branch]);
    if (!exists) await hydrate(repo.service, { actorId, scope, lease,
      inputs: await treeInputs(repo.service, { scope, commit: input.tree }) });
  });
  return compileGate(context, actorId, { scope, expectedVersion: (await repo.service.getBranch(scope)).revision, key: input.key });
}

/** Subscribe before enqueue; do not hold the source queue while the compiler snapshots. */
export async function compileGate(context: ModuleContext, actorId: Id, input: {
  readonly scope: Scope; readonly expectedVersion: number; readonly key: string;
}): Promise<CompileJob> {
  const compiler = context.services.get("compiler");
  const terminal = new Map<Id, string>();
  let notify: (() => void) | undefined;
  const unsubscribe = context.events.subscribe(event => {
    if (event.topic !== "job.changed") return;
    terminal.set(event.payload.resourceId, event.payload.status);
    notify?.();
  });
  const signal = AbortSignal.timeout(120000);
  try {
    const job = await compiler.enqueue(actorId, {
      scope: input.scope, expectedRevision: input.expectedVersion, clean: false,
    }, `git-compile:${input.key}`);
    let current = job;
    for (;;) {
      switch (current.status) {
        case "queued":
        case "running":
          if (!terminal.has(job.id)) await new Promise<void>((resolve, reject) => {
            const abort = () => { notify = undefined; reject(new ServiceError("COMPILE_TIMEOUT", 409, "Compile gate timed out")); };
            notify = () => { signal.removeEventListener("abort", abort); notify = undefined; resolve(); };
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          });
          terminal.delete(job.id);
          current = await compiler.get(actorId, job.id);
          break;
        case "succeeded": return current;
        case "failed":
        case "timeout":
        case "canceled": return fail("COMPILE_REQUIRED", 409, `Compile did not succeed: ${current.status}`);
        default: return assertNever(current.status);
      }
    }
  } finally { unsubscribe(); }
}
