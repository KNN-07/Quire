import type { Event } from "@quire/contracts";
import type { EditorClient, EditorWorkspace } from "../shared";
import { editorEvents } from "../shared/events";

export type ProjectEventSubscription = {
  readonly promise: Promise<void>;
  readonly dispose: () => void;
};

export function subscribeProjectEvents(input: {
  readonly client: EditorClient;
  readonly workspace: Pick<EditorWorkspace, "scope" | "requestHeaders"> & {
    readonly access: Pick<EditorWorkspace["access"], "actorId">;
  };
  readonly topics: ReadonlySet<Event["topic"]>;
  readonly onOpen?: () => void;
  readonly onEvent: (event: Event) => void;
}): ProjectEventSubscription {
  const controller = new AbortController();
  const promise = (async () => {
    let cursor = 0;
    while (!controller.signal.aborted) {
      try {
        await editorEvents({ client: input.client, headers: input.workspace.requestHeaders,
          actorId: input.workspace.access.actorId,
          signal: controller.signal, after: cursor,
          onOpen: () => input.onOpen?.(),
          receive: event => {
            cursor = event.seq;
            if (event.aggregateId === input.workspace.scope.projectId && input.topics.has(event.topic)) {
              input.onEvent(event);
            }
          },
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!(error instanceof TypeError)) throw error;
      }
      if (!controller.signal.aborted) {
        await new Promise<void>(resolve => {
          const timeout = setTimeout(done, 1000);
          function done() {
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", done);
            resolve();
          }
          controller.signal.addEventListener("abort", done, { once: true });
        });
      }
    }
  })();
  return { promise, dispose: () => controller.abort() };
}
