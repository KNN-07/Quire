import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { IdSchema, endpoints } from "@quire/contracts";
import type { AiRun, Preferences } from "@quire/contracts";
import { EditorApiError, editorValue } from "../shared";
import type { AiConsentMetadata, AssistantPanelProps, Conversation, Security, Usage } from "./types";
import { assistantEvents } from "./events";

export function useAssistant(props: AssistantPanelProps) {
  const { client, workspace } = props;
  const headers = workspace.requestHeaders;
  const params = { p: workspace.scope.projectId };
  const intent = props.diagnosticFix?.key ?? props.threadContext?.key;
  const intentKey = intent ? `:${intent}` : "";
  const storageKey = `quire:assistant:${workspace.access.actorId}:${params.p}:${workspace.scope.branch}${intentKey}`;
  const abort = useRef(new AbortController());
  const current = useRef<AiRun | null>(null);
  const runEpoch = useRef(0);
  const authorityEpoch = useRef(0);
  const [run, setRun] = useState<AiRun | null>(null);
  const [preferences, setPreferencesValue] = useState<Preferences | null>(null);
  const setPreferences = (value: Preferences) => {
    setPreferencesValue(value);
    if (props.preferences?.version !== value.version) props.onPreferencesChange?.(value);
  };
  const [security, setSecurity] = useState<Security | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [consentMetadata, setConsentMetadata] = useState<AiConsentMetadata | null>(null);
  const [conversation, setConversationValue] = useState<Conversation | null>(null);
  const [availability, setAvailability] = useState<string>("Checking provider configuration");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const updateRun = useCallback((value: AiRun | null) => {
    if (abort.current.signal.aborted) return;
    if (value && current.current?.id === value.id && current.current.version > value.version) return;
    if (value?.id !== current.current?.id) runEpoch.current++;
    current.current = value;
    setRun(value);
    if (value) sessionStorage.setItem(
      `quire:assistant:${workspace.access.actorId}:${value.scope.projectId}:${value.scope.branch}${intentKey}`, value.id);
    else sessionStorage.removeItem(storageKey);
  }, [storageKey, workspace.access.actorId, intentKey]);
  const readRun = async (id: AiRun["id"]) => {
    const signal = abort.current.signal;
    const epoch = runEpoch.current;
    const value = editorValue(await client.call(endpoints.aiRunGet, {
      params: { id }, query: {}, body: undefined, headers,
    }, signal));
    if (signal.aborted) return value;
    if (epoch !== runEpoch.current) return value;
    if (props.diagnosticFix && value.proposals.some(proposal => proposal.edits.some(edit => edit.status === "pending"))) {
      const access = editorValue(await client.call(endpoints.projectAccess, {
        params, query: { branch: workspace.scope.branch }, body: undefined, headers,
      }, signal));
      if (signal.aborted || epoch !== runEpoch.current) return value;
      if (access.branchRevision !== props.diagnosticFix.revision) {
        updateRun(null);
        setNotice("Diagnostic source changed. Discarded the late proposal; recompile and choose a fresh diagnostic.");
        return value;
      }
    }
    updateRun(value);
    const publishedEpoch = runEpoch.current;
    if (value.conversationId && (value.mode === "ask" || conversation?.id === value.conversationId)) {
      const chat = editorValue(await client.call(endpoints.aiConversationGet, {
        params: { ...params, id: value.conversationId }, query: {}, body: undefined, headers,
      }, signal));
      if (publishedEpoch === runEpoch.current) setConversationValue(chat);
    }
    return value;
  };
  const report = useCallback((failure: unknown) => {
    if (failure instanceof Error) setError(failure instanceof EditorApiError
      ? `${failure.code}: ${failure.message}` : `${failure.name}: ${failure.message}`);
    else throw failure;
  }, []);
  async function refresh() {
    const signal = abort.current.signal;
    const values = await Promise.all([
      client.call(endpoints.preferencesGet, { params: {}, query: {}, body: undefined }, signal),
      client.call(endpoints.aiSecurityGet, { params, query: {}, body: undefined, headers }, signal),
      client.call(endpoints.aiUsageGet, { params: {}, query: { month: new Date().toISOString().slice(0, 7) }, body: undefined }, signal),
      client.call(endpoints.connectionAvailability, { params: {}, query: {}, body: undefined }, signal),
      client.call(endpoints.aiConsentGet, { params: {}, query: {}, body: undefined }, signal),
    ]);
    setPreferences(editorValue(values[0]));
    setSecurity(editorValue(values[1]));
    setUsage(editorValue(values[2]));
    setConsentMetadata(editorValue(values[4]));
    const configured = editorValue(values[3])["ai"];
    setAvailability(configured
      ? `${configured.state}: ${configured.reason ?? (configured.enabled ? "Configured provider" : "Provider unavailable")}`
      : "AI provider is not installed in this server");
  }
  async function execute(action: () => Promise<void>) {
    if (busy) return;
    const signal = abort.current.signal;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); }
    catch (failure) { if (!signal.aborted) report(failure); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  const initialize = useEffectEvent(async () => {
    await refresh();
    const saved = sessionStorage.getItem(storageKey);
    if (saved) await readRun(IdSchema.parse(saved));
  });
  const receive = useEffectEvent(async (event: Parameters<Parameters<typeof assistantEvents>[0]["receive"]>[0]) => {
      if (event.topic === "operation.changed" && event.aggregateId === current.current?.id) {
        await readRun(event.aggregateId);
        await refresh();
      }
      if (event.topic === "policy.changed" || event.topic === "access.changed") {
        authorityEpoch.current++;
        const reviewer = current.current?.tool === "citation-reviewer" ? current.current : null;
        await refresh(); await props.refreshWorkspace();
        // Notifications can replay older policy events after reload. Recheck the
        // current run instead of erasing a still-authorized session receipt.
        if (reviewer && current.current?.id === reviewer.id) {
          try { await readRun(reviewer.id); }
          catch (failure) { if (current.current?.id === reviewer.id) updateRun(null); throw failure; }
        }
      }
  });
  const subscribe = useEffectEvent((notificationSignal: AbortSignal) =>
    assistantEvents({ client, headers, signal: notificationSignal, receive }));
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    const opened = () => setOnline(true);
    const closed = () => setOnline(false);
    window.addEventListener("online", opened); window.addEventListener("offline", closed);
    void initialize().catch(failure => { if (!controller.signal.aborted) report(failure); });
    void subscribe(controller.signal)
      .catch(failure => { if (!controller.signal.aborted) report(failure); });
    return () => {
      controller.abort();
      window.removeEventListener("online", opened); window.removeEventListener("offline", closed);
    };
  }, [client, report]);
  return {
    ...props, params, headers, get signal() { return abort.current.signal; },
    get authorityEpoch() { return authorityEpoch.current; }, run, preferences: props.preferences ?? preferences, setPreferences,
    security, setSecurity, usage, consentMetadata, conversation,
    setConversation: (value: Conversation | null) => {
      runEpoch.current++; setConversationValue(value);
      if (current.current?.mode === "ask" && current.current.conversationId !== value?.id) updateRun(null);
    }, availability,
    busy, error, notice, online, execute, refresh, updateRun, readRun, setNotice,
  };
}
export type AssistantState = ReturnType<typeof useAssistant>;
