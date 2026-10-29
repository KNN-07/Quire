export function referenceReceipt(
  storage: Pick<Storage, "getItem" | "setItem">, authority: string, scope: string, message?: string,
): string {
  // One tab-local slot, with an opaque session fingerprint rather than a credential.
  const key = "quire:inline-reference-receipt";
  const prefix = `${JSON.stringify([authority, scope])}\n`;
  if (message !== undefined) storage.setItem(key, prefix + message);
  const saved = storage.getItem(key);
  return saved?.startsWith(prefix) ? saved.slice(prefix.length) : "";
}
