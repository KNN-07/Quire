import { useEffect, useRef, useState } from "react";
import { endpoints } from "@quire/contracts";
import { EditorApiError, editorValue } from "../shared";
import type { DocumentSnapshot, EffectiveAccess, SourcePanelProps } from "../shared";
import { draftConflict, draftKey, freshDraft, proposalBody, readDraft, saveDraft } from "./tracking";
import type { SourceDraft } from "./tracking";

export function useSourceTracking(props: SourcePanelProps, snapshot: DocumentSnapshot) {
  const key = draftKey(props.workspace, props.document);
  const [draft, setDraft] = useState(() => readDraft(key, props.document));
  const current = useRef(draft);
  current.current = draft;
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [access, setAccess] = useState<EffectiveAccess | null>(props.workspace.access);
  const online = snapshot.persistence.kind === "saved";
  const canTrack = access !== null && access.actorId !== null && access.actorId === props.workspace.access.actorId
    && access.capabilities.review && access.benefits.trackChanges;
  const conflict = draftConflict(props.document, draft);
  const dirty = draft.base !== draft.text;
  const editable = canTrack && online && !conflict && !busy && !draft.submission;
  const write = (next: SourceDraft) => {
    current.current = next;
    setDraft(next);
    try { saveDraft(key, next); }
    catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      setError(`Draft is retained only in this page's memory: ${cause.message}. Copy it before closing this tab.`);
    }
  };
  // The transport publishes when live authority changes, even for Reviewer -> Viewer
  // where both roles are source-read-only. Do not depend on an open Assistant/Review pane.
  useEffect(() => {
    if (!online) return undefined;
    const controller = new AbortController();
    void props.client.call(endpoints.projectAccess, {
      params: { p: props.workspace.scope.projectId }, query: { branch: props.workspace.scope.branch },
      body: undefined, headers: props.workspace.requestHeaders,
    }, controller.signal).then(result => {
      if (!controller.signal.aborted) setAccess(editorValue(result));
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (!(cause instanceof Error)) throw cause;
      setAccess(null); setError(cause.message);
    });
    return () => controller.abort();
  }, [props.client, props.document, props.workspace.access, snapshot, online]);
  useEffect(() => { props.onTrackingChange?.(draft.enabled); }, [draft.enabled, props.onTrackingChange]);
  useEffect(() => {
    if (draft.enabled && conflict && !dirty && !draft.submission) {
      write(freshDraft(props.document, draft.enabled));
      setGeneration(value => value + 1);
    }
  }, [conflict, dirty, props.document, draft.enabled, draft.submission]);
  useEffect(() => {
    if (!dirty && !draft.submission) return undefined;
    const leaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [dirty, draft.submission]);
  const submit = async () => {
    if (!canTrack || !online || busy || !dirty) return;
    setBusy(true); setError("");
    const replay = current.current.submission !== null;
    try {
      let submission = current.current.submission;
      const latestAccess = editorValue(await props.client.call(endpoints.projectAccess, {
        params: { p: props.workspace.scope.projectId }, query: { branch: props.workspace.scope.branch },
        body: undefined, headers: props.workspace.requestHeaders,
      }));
      if (!latestAccess.capabilities.review || !latestAccess.benefits.trackChanges
        || latestAccess.actorId !== props.workspace.access.actorId) throw new Error("Permission to propose changes is no longer available. Your draft is retained.");
      if (!submission) {
        submission = { key: crypto.randomUUID(), body: proposalBody(props.document, current.current, latestAccess.branchRevision) };
        // Persist the exact request before sending it: a lost reply can only retry this request.
        const pending = { ...current.current, submission };
        saveDraft(key, pending);
        current.current = pending; setDraft(pending);
      }
      editorValue(await props.client.call(endpoints.suggestionCreate, {
        params: { p: props.workspace.scope.projectId }, query: {}, body: submission.body,
        headers: { ...props.workspace.requestHeaders, "idempotency-key": submission.key },
      }));
      write(freshDraft(props.document, true));
      setGeneration(value => value + 1);
      await props.refreshWorkspace();
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      // A denial of a retry says nothing about the original, possibly committed request.
      if (!replay && cause instanceof EditorApiError) write({ ...current.current, submission: null });
      setError(cause.message);
    } finally { setBusy(false); }
  };
  return {
    draft, generation, busy, error, canTrack, conflict, dirty, editable, online,
    change: (text: string) => write({ ...current.current, text }),
    toggle: () => {
      if (busy || (!draft.enabled && (!canTrack || !online))) return;
      write(!draft.enabled && !dirty && !draft.submission
        ? freshDraft(props.document, true) : { ...current.current, enabled: !draft.enabled });
      setGeneration(value => value + 1);
    },
    discard: () => { write(freshDraft(props.document, draft.enabled)); setError(""); setGeneration(value => value + 1); },
    submit,
  };
}
