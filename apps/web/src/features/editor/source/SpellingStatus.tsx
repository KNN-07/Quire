import { assertNever } from "@quire/contracts";
import type { SpellingState } from "./spelling";

export function SpellingStatus({ state, compact = false }: { readonly state: SpellingState; readonly compact?: boolean }) {
  switch (state.kind) {
    case "off": return compact ? null : <p role="status">Spelling is turned off.</p>;
    case "loading": return compact ? null : <p role="status">Loading the selected spelling dictionary.</p>;
    case "ready": return compact ? null : <p role="status">Spelling: {state.locale} ({state.version}). <a href={state.license} target="_blank" rel="noreferrer">Dictionary license</a></p>;
    case "unavailable": return <p role="alert">{state.message}</p>;
    case "error": return <p role="alert">Could not load the spelling dictionary: {state.message}. Reopen preferences or choose another dictionary.</p>;
    default: return assertNever(state);
  }
}
