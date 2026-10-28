/** Await one exact completion/abort event; detach the abort listener on either outcome. */
export async function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const canceled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new DOMException("Operation canceled", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([work(), canceled]); }
  finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
}
