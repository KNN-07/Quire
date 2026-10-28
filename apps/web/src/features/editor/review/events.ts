import ky from "ky";
import { EventSchema, endpoints } from "@quire/contracts";
import type { Event } from "@quire/contracts";
import type { EditorClient, EditorWorkspace } from "../shared";

export type ProjectEventSubscription = {
  readonly promise: Promise<void>;
  readonly dispose: () => void;
};

export function subscribeProjectEvents(input: {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly topics: ReadonlySet<Event["topic"]>;
  readonly onOpen?: () => void;
  readonly onEvent: (event: Event) => void;
}): ProjectEventSubscription {
  const controller = new AbortController();
  const promise = (async () => {
    let cursor = 0;
    while (!controller.signal.aborted) {
      try {
        const url = input.client.url(endpoints.events, {
          params: {}, query: { after: cursor }, body: undefined,
        });
        const response = await ky(url, {
          headers: input.workspace.requestHeaders,
          credentials: "same-origin",
          retry: 0,
          timeout: false,
          signal: controller.signal,
        });
        if (!response.body) throw new TypeError("Missing project event stream");
        input.onOpen?.();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffered += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
            let boundary = buffered.indexOf("\n\n");
            while (boundary >= 0) {
              const frame = buffered.slice(0, boundary);
              buffered = buffered.slice(boundary + 2);
              const data = frame.split("\n").filter(line => line.startsWith("data:"))
                .map(line => line.slice(5).trimStart()).join("\n");
              if (data) {
                const event = EventSchema.parse(JSON.parse(data));
                cursor = event.seq;
                if (event.aggregateId === input.workspace.scope.projectId && input.topics.has(event.topic)) {
                  input.onEvent(event);
                }
              }
              boundary = buffered.indexOf("\n\n");
            }
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
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
