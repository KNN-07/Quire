const listeners = new Set<() => void>();
let enabled = true;
export const getCodeCheckEnabled = () => enabled;
export function subscribeCodeCheck(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Global to source panels in this browser session, not a persisted preference. */
export function setCodeCheckEnabled(value: boolean): void {
  enabled = value;
  for (const listener of listeners) listener();
}
