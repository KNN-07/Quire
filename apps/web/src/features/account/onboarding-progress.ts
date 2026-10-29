import { useEffect, useRef, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Onboarding, OnboardingChoices } from "@quire/contracts";
import { mutationHeaders, readInput, unwrap } from "./shared";
import type { AccountPageProps } from "./shared";

/** Anonymous progress is only a screen hint, never account or verification evidence. */
const anonymousKey = "quire.onboarding.screen.v1";
export function onboardingScreen(): "create" | "verify" | "signin" {
  const screen = sessionStorage.getItem(anonymousKey);
  return screen === "verify" || screen === "signin" ? screen : "create";
}
export function rememberOnboardingScreen(screen: "create" | "verify" | "signin"): void {
  sessionStorage.setItem(anonymousKey, screen);
}
export async function openOnboardingProject(props: AccountPageProps, saved: Onboarding): Promise<void> {
  if (!saved.projectId) throw new Error("The created project is not available yet.");
  const account = unwrap(await props.client.call(endpoints.me, readInput));
  if (account.user.id !== saved.actorId) throw new Error("Account changed; reload onboarding.");
  if (account.preferences.defaultView !== saved.choices.defaultView) {
    unwrap(await props.client.call(endpoints.preferencesPatch, { params: {}, query: {},
      body: { defaultView: saved.choices.defaultView, expectedVersion: account.preferences.version } }));
  }
  props.navigate(`/projects/${saved.projectId}/edit`);
}

export function useOnboarding(client: AccountPageProps["client"]) {
  const [progress, setProgress] = useState<Onboarding | null>(null);
  const [choices, setChoices] = useState<OnboardingChoices | null>(null);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [pending, setPending] = useState(0);
  const [generation, setGeneration] = useState(0);
  const current = useRef<Onboarding | null>(null);
  const blocked = useRef(false);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    const controller = new AbortController();
    current.current = null; blocked.current = false;
    setProgress(null); setChoices(null); setError(""); setSignedOut(false);
    void client.call(endpoints.onboardingGet, readInput, controller.signal).then(async result => {
      if (controller.signal.aborted) return;
      if ("error" in result && result.error.code === "UNAUTHENTICATED") { setSignedOut(true); return; }
      const initial = unwrap(result);
      const saved = initial.importState?.attempt ? unwrap(await client.call(endpoints.onboardingImportRecover, {
        params: {}, query: {}, body: { actorId: initial.actorId },
      }, controller.signal)).progress : initial;
      if (controller.signal.aborted) return;
      current.current = saved; setProgress(saved); setChoices(saved.choices);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof Error) setError(cause.message); else throw cause;
    });
    return () => { controller.abort(); blocked.current = true; };
  }, [client, generation]);
  function accept(saved: Onboarding) {
    current.current = saved; setProgress(saved);
  }
  function save(next: OnboardingChoices) {
    setChoices(next); setPending(count => count + 1);
    queue.current = queue.current.then(async () => {
      const saved = current.current;
      if (blocked.current || !saved) return;
      accept(unwrap(await client.call(endpoints.onboardingSave, { params: {}, query: {},
        body: { actorId: saved.actorId, expectedVersion: saved.version, choices: next }, headers: mutationHeaders() })));
    }).catch((cause: unknown) => {
      blocked.current = true;
      if (cause instanceof Error) setError(cause.message); else throw cause;
    }).finally(() => setPending(count => count - 1));
  }
  return { progress, choices, pending, error, signedOut, save, accept,
    reload: () => setGeneration(value => value + 1) };
}
