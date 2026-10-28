import type { UpdateService } from "./service";

export interface UpdateTimer {
  /** Subscribe before advancing an injected clock; callback owns its async completion. */
  at(instant: string, callback: () => Promise<void>): () => void;
}
export const systemUpdateTimer: UpdateTimer = {
  at: (instant, callback) => {
    const timeout = setTimeout(() => { void callback(); }, Math.min(2_147_483_647, Math.max(0, Date.parse(instant) - Date.now())));
    return () => clearTimeout(timeout);
  },
};
export function startScheduler(service: UpdateService, onError: (error: unknown) => void, timer: UpdateTimer = systemUpdateTimer):
{ readonly close: () => Promise<void> } {
  let cancel: (() => void) | null = null;
  let closed = false;
  let generation = 0;
  async function arm(): Promise<void> {
    const revision = ++generation;
    cancel?.(); cancel = null;
    const next = await service.nextAt();
    if (closed || revision !== generation || !next) return;
    cancel = timer.at(next, async () => {
      try { await service.tick(); if (!closed) await arm(); }
      catch (error) { onError(error); }
    });
  }
  const unsubscribe = service.subscribe(() => { void arm().catch(onError); });
  void arm().catch(onError);
  return { close: async () => {
    closed = true; generation++;
    cancel?.(); unsubscribe();
    await service.close();
  } };
}
