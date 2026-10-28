/** Public build setting; this limits local editing, never server authorization. */
export function offlineWindowMs(value = import.meta.env["VITE_QUIRE_OFFLINE_WINDOW_MS"]): number {
  if (value === undefined) return 600_000;
  const milliseconds = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(milliseconds)
    || milliseconds < 1 || milliseconds > 2_147_483_647) {
    throw new TypeError("VITE_QUIRE_OFFLINE_WINDOW_MS must be an integer from 1 to 2147483647 milliseconds");
  }
  return milliseconds;
}
