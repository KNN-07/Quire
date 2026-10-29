import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { closeCompletion } from "@codemirror/autocomplete";
import { assertNever, endpoints } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { SourcePanelProps } from "../shared";
import { editorValue } from "../shared";
import type { SourceEditor } from "./editor";
import { providers, remoteCompletion } from "./remote-completion";
import type { RemoteCompletionState } from "./remote-completion";
import { referenceReceipt } from "./reference-receipt";
import { Button } from "../../../ui";

// Keep copy receipts visible when the original document unmounts during an HTTP copy.
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useInlineReferences(props: SourcePanelProps, editor: SourceEditor | null, tracking: boolean) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const configuration = useRef<HTMLDivElement>(null);
  const [provider, setProvider] = useState("");
  const [target, setTarget] = useState<Id | null>(null);
  const [authority, setAuthority] = useState<{
    readonly document: SourcePanelProps["document"]; readonly actorId: Id; readonly session: string;
  } | null>(null);
  const [authorityError, setAuthorityError] = useState("");
  const [transient, setTransient] = useState<{ readonly scope: string; readonly session: string; readonly message: string } | null>(null);
  const receiptKey = `${props.workspace.scope.projectId}:${props.workspace.scope.branch}`;
  const session = authority?.document === props.document && authority.actorId === props.workspace.access.actorId
    ? authority.session : null;
  const saved = useSyncExternalStore(subscribe, () => session ? referenceReceipt(sessionStorage, session, receiptKey) : "");
  const message = transient?.scope === receiptKey && transient.session === session ? transient.message : saved;
  useEffect(() => {
    const controller = new AbortController();
    setAuthorityError("");
    void props.client.call(endpoints.me, { params: {}, query: {}, body: undefined }, controller.signal)
      .then(async result => {
        const account = editorValue(result);
        if (account.user.id !== props.workspace.access.actorId) throw new TypeError("Reopen the editor after changing accounts.");
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(account.csrfToken));
        if (!controller.signal.aborted) setAuthority({ document: props.document, actorId: account.user.id,
          session: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") });
      }).catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (!(failure instanceof Error)) throw failure;
        setAuthorityError(failure.message);
      });
    return () => controller.abort();
  }, [props.client, props.document, props.workspace.access.actorId]);
  const files = props.workspace.files.filter(file => file.kind === "file" && file.editable && !file.link && /\.bib$/i.test(file.path));
  const selected = files.find(file => file.id === target) ?? (files.length === 1 ? files[0] : undefined);
  const persistence = props.document.getSnapshot().persistence;
  let connected: boolean;
  switch (persistence.kind) {
    case "saved": case "saving": connected = true; break;
    case "connecting": case "offline": case "recovery": case "closed": connected = false; break;
    default: return assertNever(persistence);
  }
  const blocked = !session ? authorityError || "Checking the current reference session."
    : !props.preferences.autocomplete ? "Autocomplete is off. Enable it in Source preferences before remote completion."
    : tracking ? "Remote completion is unavailable while Track changes is on."
      : !props.workspace.access.capabilities.edit || props.document.getSnapshot().readOnly ? "Remote insertion requires current editing authority."
        : !connected ? "Reconnect and recover source before remote completion."
          : files.length > 1 && !selected ? "Choose an editable bibliography before remote completion."
            : !files.length && props.workspace.files.some(file => file.path === "references.bib")
              ? "references.bib is occupied and cannot be overwritten. Create an editable .bib file first." : null;
  const latest = useRef<RemoteCompletionState>({ props, provider, target: selected?.id ?? null, blocked, session });
  latest.current = { props, provider, target: selected?.id ?? null, blocked, session };
  const controller = useMemo(() => remoteCompletion(() => latest.current, (value, senderSession, retain) => {
    setTransient(previous => value !== null ? { scope: receiptKey, session: senderSession, message: value }
      : previous?.scope === receiptKey && previous.session === senderSession ? null : previous);
    if (retain && value !== null) {
      referenceReceipt(sessionStorage, senderSession, receiptKey, value);
      for (const listener of listeners) listener();
    }
  }), [receiptKey]);
  useEffect(() => {
    controller.invalidate();
    if (editor) closeCompletion(editor.view);
    return () => controller.invalidate();
  }, [controller, editor, provider, selected?.id, blocked, props.document, props.preferences.autocomplete, session]);
  const controls = <details className="q-source-references" ref={disclosure} onToggle={event => {
    if (event.currentTarget.open && configuration.current) configuration.current.scrollTop = 0;
  }}>
    <summary>References: {providers.find(([value]) => value === provider)?.[1] ?? "Off"}</summary>
    <div className="q-source-stack" ref={configuration}>
      <label>Inline reference provider<select aria-label="Inline reference provider" value={provider}
        disabled={!!blocked && !provider}
        onChange={event => { controller.invalidate(); setProvider(event.target.value); }}>
        <option value="">Off (local keys only)</option>
        {providers.map(([value, label]) => <option key={value} value={value} disabled={!!blocked}>
          {label}{value === "mendeley" ? " (account grant required)" : ""}
        </option>)}
        <option disabled>ReadCube: unavailable</option><option disabled>Dimensions: unavailable</option>
      </select></label>
      <p>Enabling a provider sends only the typed citation query, not document text. Search fields and syntax depend on the provider.
        Account Library and linked bibliographies are separate. Enter accepts; arrows select; Escape closes.</p>
      <label>Inline bibliography destination<select aria-label="Inline bibliography destination"
        value={selected?.id ?? ""} disabled={!files.length}
        onChange={event => { controller.invalidate(); setTarget(files.find(file => file.id === event.target.value)?.id ?? null); }}>
        <option value="">{files.length ? "Choose an editable bibliography" : "Create references.bib on acceptance"}</option>
        {files.map(file => <option key={file.id} value={file.id}>{file.path}</option>)}
      </select></label>
      {blocked && <p role="status">{blocked}</p>}
      <Button onClick={() => {
        if (disclosure.current) disclosure.current.open = false;
        editor?.view.focus();
      }}>Done configuring references</Button>
    </div>
  </details>;
  return { completion: controller.source, invalidate: controller.invalidate, controls,
    status: message ? <p className="q-source-notice q-reference-status" role="status">{message}</p> : null };
}
