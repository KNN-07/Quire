import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";

type Context = Pick<ModuleContext,"services"|"admission">;
type Task = {readonly controller:AbortController;readonly settled:Promise<void>};
type Supervisor = {
  // Mutable lifecycle state; each context owns its task set and serial build turn.
  closed:boolean; readonly tasks:Set<Task>; turn:Promise<void>;
};
const supervisors = new WeakMap<object,Supervisor>();
function supervisor(context:Context):Supervisor {
  let state=supervisors.get(context.services);
  if (!state) {state={closed:false,tasks:new Set(),turn:Promise.resolve()};supervisors.set(context.services,state);}
  return state;
}
export function superviseEnvironmentWork<T>(context:Context,work:(signal:AbortSignal)=>Promise<T>):Promise<T> {
  const state=supervisor(context);
  if (state.closed) return Promise.reject(new ServiceError("ENVIRONMENT_BUILDS_STOPPED",503,"Environment supervisor is stopping"));
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),1_200_000);
  const result=Promise.resolve().then(()=>work(controller.signal));
  const settled=Promise.allSettled([result]).then(()=>{
    clearTimeout(timeout);state.tasks.delete(task);
  });
  const task={controller,settled};
  state.tasks.add(task);
  return result;
}
export async function serializeEnvironmentWork<T>(context:Context,work:()=>Promise<T>):Promise<T> {
  const state=supervisor(context);
  const previous=state.turn;
  const release=Promise.withResolvers<void>();
  state.turn=release.promise;
  await previous;
  try {return await context.admission.background(work);} finally {release.resolve();}
}
export async function stopEnvironmentBuilds(context:Context):Promise<void> {
  const state=supervisors.get(context.services);
  if (!state) return;
  state.closed=true;
  const tasks=[...state.tasks];
  for (const task of tasks) task.controller.abort();
  await Promise.all(tasks.map(task=>task.settled));
}
