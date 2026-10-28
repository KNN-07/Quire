import type { ToolState } from "./use-tool";

export function Feedback({ state }: { readonly state: ToolState }) {
  return <>
    {state.blocked && <p role="status">{state.blocked}</p>}
    {state.busy && <p role="status">Working...</p>}
    {state.error && <p role="alert" className="editor-tools__error">{state.error}</p>}
    {state.message && <p role="status">{state.message}</p>}
  </>;
}
