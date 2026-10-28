import type { Digest, FileEntry, Id, Scope } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { HttpReceipt } from "./receipts";
import { fail } from "./store";

export interface ExternalLinks {
  create(input: {
    readonly actorId: Id; readonly scope: Scope; readonly path: string;
    readonly kind: "url" | "bibliography"; readonly url?: string; readonly grantId?: Id;
    readonly expectedVersion: number; readonly http?: HttpReceipt;
  }): Promise<FileEntry>;
  refresh(input: {
    readonly actorId: Id; readonly scope: Scope; readonly fileId: Id;
    readonly expectedDigest: Digest; readonly expectedVersion: number; readonly http?: HttpReceipt;
  }): Promise<FileEntry>;
}
const adapters = new WeakMap<object, ExternalLinks>();
export function provideExternalLinks(context: ModuleContext, links: ExternalLinks): void {
  if (adapters.has(context.db)) fail("DUPLICATE_LINK_ADAPTER", 500, "External links already registered");
  adapters.set(context.db, links);
}
export function externalLinks(context: ModuleContext): ExternalLinks {
  const adapter = adapters.get(context.db);
  if (!adapter) fail("LINK_ADAPTER_REQUIRED", 503, "External links require the configured adapter");
  return adapter;
}
