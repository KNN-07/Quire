import { endpoints } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { RealtimeService } from "./realtime";
import { HistoryStore } from "./history-store";
import { registerEvents } from "./events";
import { registerThreads } from "./threads";
import { registerComments } from "./comments";
import { registerSuggestions } from "./suggestions";
import { registerHistory } from "./history";

export { migrations } from "./recovery";
export { RealtimeService } from "./realtime";
const disposers = new WeakMap<object, () => void>();
export function register(context: ModuleContext): void {
  const realtime = new RealtimeService(context);
  const store = new HistoryStore(context);
  context.services.provide("realtime", realtime);
  context.routes.registerTransport(endpoints.realtime, () => new Response("WebSocket upgrade required", { status: 426 }));
  const stopEvents = registerEvents(context, store);
  registerThreads(context, store);
  registerComments(context, store);
  registerSuggestions(context, store);
  const stopHistory = registerHistory(context, store);
  disposers.set(context.db, () => { stopEvents(); stopHistory(); realtime.dispose(); });
}
/** Composition calls before closing the SQLite connection or replacing this runtime. */
export function dispose(context: Pick<ModuleContext, "db">): void {
  disposers.get(context.db)?.();
  disposers.delete(context.db);
}
