import type { Event } from "@quire/contracts";
import type { EditorApplication } from "./application";

export class EventWaitError extends Error {
  constructor(readonly reason: "timeout" | "disposed") {
    super(`Application event subscription ${reason}`);
    this.name = "EventWaitError";
  }
}
/** Register before the action. Dispose cancels the subscription and its bounded timeout. */
export function nextApplicationEvent(app: EditorApplication, accepts: (event: Event) => boolean, timeoutMs = 30_000) {
  const result = Promise.withResolvers<Event>();
  let settled = false;
  const cleanup = () => { clearTimeout(timeout); unsubscribe(); };
  const unsubscribe = app.application.runtime.events.subscribe(event => {
    if (settled || !accepts(event)) return;
    settled = true;
    cleanup();
    result.resolve(event);
  });
  const timeout = setTimeout(() => {
    settled = true;
    cleanup();
    result.reject(new EventWaitError("timeout"));
  }, timeoutMs);
  return { promise: result.promise, [Symbol.dispose]() {
    cleanup();
    if (!settled) { settled = true; result.reject(new EventWaitError("disposed")); }
  } };
}
