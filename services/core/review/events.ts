import { endpoints, IdSchema, assertNever } from "@quire/contracts";
import type { Event } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { fail } from "./store";
import type { ReviewStore } from "./store";
import { operationEventScope } from "./operation-events";

export function registerEvents(context: ModuleContext, store: ReviewStore): () => Promise<void> {
  const active = new Set<() => void>();
  const pending = new Set<Promise<void>>();
  const track = (task: Promise<void>) => {
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  context.routes.registerTransport(endpoints.events, async ({ request }) => {
    const identity = context.services.get("identity");
    const principal = await identity.authenticate(request);
    let anonymousProject: Id | null = null;
    if (!principal) {
      const token = request.headers.get("x-project-token");
      if (!token) fail("UNAUTHENTICATED", 401, "Authentication or a project credential is required");
      const row = (await context.db.get<{ project_id: string }>("SELECT project_id FROM share_tokens WHERE token_hash=? AND revoked_at IS NULL", [new Bun.CryptoHasher("sha256").update(token).digest("hex")]));
      if (!row) fail("UNAUTHENTICATED", 401, "Project credential is not valid");
      anonymousProject = IdSchema.parse(row.project_id);
      const project = (await store.projects.getProject(anonymousProject));
      await store.authorizeRead(request, { projectId: project.id, branch: project.defaultBranch });
    }
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(key => key !== "after")) fail("INVALID_INPUT", 400, "Unknown event query");
    const after = Number(request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) fail("INVALID_INPUT", 400, "Invalid event cursor");
    let end: (closeOutput?: boolean) => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let cursor = after;
        let closed = false;
        let tail = Promise.resolve();
        const projects = new Set<string>();
        if (anonymousProject) projects.add(anonymousProject);
        const enqueue = (value: string) => { if (!closed) controller.enqueue(new TextEncoder().encode(value)); };
        const unsubscribe = context.events.subscribe(event => {
          tail = track(tail.then(() => deliver(event, true)).catch(error => {
            if (error instanceof ServiceError) { end(); return; }
            controller.error(error); end(false);
          }));
        });
        const abort = () => end();
        end = (closeOutput = true) => {
          if (closed) return;
          closed = true;
          unsubscribe(); active.delete(end);
          request.signal.removeEventListener("abort", abort);
          if (closeOutput) controller.close();
        };
        active.add(end);
        request.signal.addEventListener("abort", abort, { once: true });
        async function deliver(event: Event, live: boolean): Promise<void> {
          if (closed || event.seq <= cursor) return;
          if (principal) {
            const current = await identity.require(request);
            if (current.sessionId !== principal.sessionId) fail("UNAUTHENTICATED", 401, "Session changed");
          }
          cursor = event.seq;
          switch (event.topic) {
            case "session.revoked": {
              // Replay must not revoke a valid session created after an old wildcard.
              if (live && principal && event.payload.userId === principal.user.id
                && (event.payload.sessionId === null || event.payload.sessionId === principal.sessionId)) end();
              return;
            }
            case "notification.created": {
              if (principal && event.aggregateId === principal.user.id) enqueue(`id: ${event.seq}\nevent: ${event.topic}\ndata: ${JSON.stringify(event)}\n\n`);
              return;
            }
            case "policy.changed": {
              for (const projectId of projects) {
                const project = (await store.projects.getProject(IdSchema.parse(projectId)));
                await store.authorizeRead(request, { projectId: project.id, branch: project.defaultBranch });
              }
              if (principal && (event.aggregateId === principal.user.id || (await context.db.get("SELECT 1 FROM members WHERE organization_id=? AND user_id=?", [event.aggregateId, principal.user.id])))) {
                enqueue(`id: ${event.seq}\nevent: ${event.topic}\ndata: ${JSON.stringify(event)}\n\n`);
                return;
              }
              break;
            }
            case "operation.changed": {
              if (principal && (await context.db.get("SELECT 1 FROM operations WHERE id=? AND actor_id=?", [event.payload.resourceId, principal.user.id]))) {
                enqueue(`id: ${event.seq}\nevent: ${event.topic}\ndata: ${JSON.stringify(event)}\n\n`);
                return;
              }
              if (principal) {
                const scope = await operationEventScope(context,
                  { id: principal.user.id, sessionId: principal.sessionId }, event.payload.resourceId);
                if (scope) {
                  await store.authorizeRead(request, scope);
                  projects.add(scope.projectId);
                  enqueue(`id: ${event.seq}\nevent: ${event.topic}\ndata: ${JSON.stringify(event)}\n\n`);
                  return;
                }
              }
              break;
            }
            case "document.saved":
            case "tree.changed":
            case "access.changed":
            case "review.changed":
            case "history.created":
            case "git.changed":
            case "job.changed": break;
            default: assertNever(event);
          }
          if (anonymousProject && event.aggregateId !== anonymousProject) return;
          try { await store.authorizeRead(request, { projectId: event.aggregateId,
            branch: (await store.projects.getProject(event.aggregateId)).defaultBranch }); }
          catch (error) {
            if (error instanceof ServiceError) {
              if (projects.has(event.aggregateId)) end();
              return;
            }
            throw error;
          }
          projects.add(event.aggregateId);
          enqueue(`id: ${event.seq}\nevent: ${event.topic}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        // Subscribe first, then read every persisted page; queued live duplicates are discarded by seq.
        const replay = async () => {
          let next = after;
          for (;;) {
            if (closed) break;
            const page = await context.events.read(next, { limit: 200 });
            if (!page.length) break;
            for (const event of page) { await deliver(event, false); next = event.seq; }
          }
          enqueue(": ready\n\n");
        };
        tail = track(replay().catch(error => {
          if (error instanceof ServiceError) { end(); return; }
          controller.error(error); end(false);
        }));
      },
      cancel() { end(false); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream",
      "cache-control": "no-store", "x-accel-buffering": "no" } });
  });
  return async () => { for (const close of active) close(); await Promise.all(pending); };
}
