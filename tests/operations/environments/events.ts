import type { ModuleContext } from "@quire/runtime";

export function terminalOperation(context:Pick<ModuleContext,"events">) {
  const result=Promise.withResolvers<string>();
  const timeout=setTimeout(()=>result.reject(new TypeError("Environment operation terminal event timed out")),180000);
  const unsubscribe=context.events.subscribe(event=>{
    if (event.topic==="operation.changed" && !["queued","running"].includes(event.payload.status)) {
      result.resolve(event.payload.resourceId);
    }
  });
  return {promise:result.promise,[Symbol.asyncDispose]:async()=>{clearTimeout(timeout);unsubscribe();}};
}
