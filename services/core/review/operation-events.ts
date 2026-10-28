import type { Id, Scope } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";

type Reader = (actor: { readonly id: Id; readonly sessionId: Id }, resourceId: Id) => Promise<Scope | null>;
const readers = new WeakMap<object, Reader>();

export function provideOperationEventReader(context: ModuleContext, reader: Reader): void {
  if (readers.has(context.db)) throw new ServiceError("DUPLICATE_EVENT_READER", 500, "Operation event reader already registered");
  readers.set(context.db, reader);
}
export async function operationEventScope(context: ModuleContext, actor: {
  readonly id: Id; readonly sessionId: Id;
}, resourceId: Id): Promise<Scope | null> {
  return await readers.get(context.db)?.(actor, resourceId) ?? null;
}
