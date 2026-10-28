import { useEffect, useMemo, useState } from "react";
import { assertNever } from "@quire/contracts";
import type { Preferences } from "@quire/contracts";
import { loadSpelling, spellingIssues } from "./spelling";
import type { SpellingState } from "./spelling";

export function useSpelling(source: string, preferences: Preferences) {
  const [state, setState] = useState<SpellingState>({ kind: "loading" });
  const { dictionary, spellCheck, customWords } = preferences;
  useEffect(() => {
    const controller = new AbortController();
    setState(spellCheck ? { kind: "loading" } : { kind: "off" });
    void loadSpelling({ dictionary, spellCheck, customWords }, controller.signal).then(next => {
      if (!controller.signal.aborted) setState(next);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof Error) setState({ kind: "error", message: cause.message }); else throw cause;
    });
    return () => controller.abort();
  }, [dictionary, spellCheck, customWords]);
  const issues = useMemo(() => {
    switch (state.kind) {
      case "ready": return spellingIssues(source, state.checker);
      case "off": case "loading": case "error": case "unavailable": return [];
      default: return assertNever(state);
    }
  }, [source, state]);
  return { state, issues };
}
