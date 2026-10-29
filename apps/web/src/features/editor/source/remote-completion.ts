import { endpoints } from "@quire/contracts";
import type { Id, Publication } from "@quire/contracts";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { closeCompletion, pickedCompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionSection } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { EditorApiError, editorValue } from "../shared";
import type { SourcePanelProps } from "../shared";
import { bibliographyKeys } from "../tools/insertion";
import { maskedTex } from "./tex";

export const providers = [["crossref", "Crossref"], ["arxiv", "arXiv"],
  ["semanticScholar", "Semantic Scholar"], ["mendeley", "Mendeley"]] as const;

export type RemoteCompletionState = {
  readonly props: SourcePanelProps;
  readonly provider: string;
  readonly target: Id | null;
  readonly blocked: string | null;
  readonly session: string | null;
};

export function remoteCitationQuery(source: string, position: number) {
  const before = source.slice(0, position);
  // Mask closed literals/comments first, then still-open literal regions while typing.
  const active = maskedTex(before).replace(/\\\\/g, "  ").replace(
    /\\begin\{(?:verbatim\*?|lstlisting|minted)\}[\s\S]*$|\\verb\*?[^\w\s][^\n]*$/g,
    text => text.replace(/[^\n]/g, " "),
  );
  const match = /\\cite[A-Za-z]*\*?(?:\[[^\]\r\n]*\]){0,2}\s*\{[^{}]*$/.exec(active);
  if (!match) return null;
  const text = match[0];
  const from = Math.max(text.lastIndexOf("{"), text.lastIndexOf(",")) + 1;
  const query = text.slice(from);
  const start = position - query.length;
  return query.trim() && before.slice(start) === query ? { from: start, query } : null;
}

/** A controller belongs to one mounted document, never the account Library. */
export function remoteCompletion(
  current: () => RemoteCompletionState,
  report: (message: string | null, session: string, retain?: boolean) => void,
) {
  let generation = 0;
  let lookup: { readonly controller: AbortController; readonly session: string } | null = null;
  let copying = false;
  const invalidate = () => {
    generation++;
    const pending = lookup;
    lookup = null;
    pending?.controller.abort();
    if (pending) report(null, pending.session);
  };
  const source = async (context: CompletionContext): Promise<CompletionResult | null> => {
    invalidate();
    const initial = current();
    const session = initial.session;
    if (!session || !initial.provider || initial.blocked || !initial.props.preferences.autocomplete || copying) return null;
    const notify = (message: string, retain = false) => report(message, session, retain);
    const match = remoteCitationQuery(context.state.doc.toString(), context.pos);
    if (!match) return null;
    const { from: start, query } = match;
    const ticket = generation;
    const controller = new AbortController();
    lookup = { controller, session };
    context.addEventListener("abort", () => {
      controller.abort();
      if (lookup?.controller === controller) {
        lookup = null;
        report(null, session);
      }
    }, { onDocChange: true });
    const fresh = (view: EditorView) => {
      const next = current();
      return ticket === generation && next.session === session && !next.blocked && next.provider === initial.provider
        && next.target === initial.target && next.props.document === initial.props.document
        && next.props.workspace.scope.projectId === initial.props.workspace.scope.projectId
        && next.props.workspace.scope.branch === initial.props.workspace.scope.branch
        && next.props.preferences.autocomplete && !view.state.readOnly
        && view.state.doc.eq(context.state.doc) && view.state.selection.ranges.length === 1 && view.state.selection.main.empty
        && view.state.selection.main.head === context.pos;
    };
    try {
      notify("Searching remote references…");
      const page = editorValue(await initial.props.client.call(endpoints.referencesSearch, {
        params: {}, query: { projectId: initial.props.workspace.scope.projectId,
          provider: initial.provider, query: query.trim(), limit: 10 }, headers: initial.props.workspace.requestHeaders, body: undefined,
      }, controller.signal));
      if (context.aborted || controller.signal.aborted || ticket !== generation || !context.view || !fresh(context.view)) return null;
      lookup = null;
      const completionView = context.view;
      const section: CompletionSection = {
        name: "Remote references",
        header: () => {
          const document = completionView.dom.ownerDocument;
          const heading = document.createElement("li");
          heading.className = "q-reference-heading";
          heading.setAttribute("role", "presentation");
          const row = heading.appendChild(document.createElement("div"));
          const title = row.appendChild(document.createElement("strong"));
          title.textContent = "References";
          const keys = row.appendChild(document.createElement("span"));
          keys.className = "q-reference-keys";
          keys.textContent = "↑↓ Enter Esc";
          keys.title = "Arrows select; Enter cites; Escape closes";
          const close = row.appendChild(document.createElement("button"));
          close.type = "button";
          close.className = "q-button q-reference-dismiss";
          close.textContent = "Close";
          close.setAttribute("aria-label", "Close reference suggestions");
          close.addEventListener("mousedown", event => event.preventDefault());
          close.addEventListener("click", () => {
            invalidate();
            closeCompletion(completionView);
            completionView.focus();
          });
          return heading;
        },
      };
      notify(page.items.length ? ""
        : "No remote references found. Refine the citation query or choose another provider.");
      return {
        from: start, to: context.pos, filter: false,
        options: page.items.flatMap(publication => {
          const keys = bibliographyKeys(publication.bibtex);
          const key = keys.length === 1 ? keys[0]?.key : undefined;
          if (!key) return [];
          return [{
            label: key, type: "reference", section,
            detail: `${publication.title}\n${publication.authors.join("; ") || "Authors not supplied"}\n${publication.year ?? "Year not supplied"} · ${providers.find(([value]) => value === publication.provider)?.[1] ?? publication.provider}`,
            apply: (view: EditorView, completion: Completion) => { void accept(view, { publication, key, completion }); },
          }];
        }),
      };
    } catch (failure) {
      if (controller.signal.aborted || ticket !== generation) return null;
      if (!(failure instanceof Error)) throw failure;
      lookup = null;
      notify(failure instanceof EditorApiError && ["PROVIDER_UNCONFIGURED", "PROVIDER_DISABLED"].includes(failure.code)
        ? "This reference provider is unavailable. Choose another provider or ask an administrator to configure it."
        : `${failure.message} Try the query again or choose another provider.`);
      return null;
    }

    async function accept(view: EditorView, candidate: { readonly publication: Publication; readonly key: string; readonly completion: Completion }) {
      const { publication, key, completion } = candidate;
      if (copying || !fresh(view)) { notify("Reference selection is stale. Complete the current query again."); return; }
      copying = true;
      let copied = "";
      const { props } = initial;
      const params = { p: props.workspace.scope.projectId };
      try {
        notify("Copying reference to project bibliography…");
        await props.document.flush();
        if (!fresh(view)) throw new EditorApiError("STALE_REFERENCE", "Source or reference settings changed before bibliography copy.");
        const access = editorValue(await props.client.call(endpoints.projectAccess, {
          params, query: { branch: props.workspace.scope.branch }, headers: props.workspace.requestHeaders, body: undefined,
        }));
        if (!access.capabilities.edit || !fresh(view)) throw new EditorApiError("STALE_REFERENCE", "Source or editing authority changed before bibliography copy.");
        const file = editorValue(await props.client.call(endpoints.citationCreate, {
          params, query: {}, headers: { ...props.workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
          body: { scope: props.workspace.scope, publication, command: "cite", expectedVersion: access.branchRevision,
            ...(initial.target ? { targetFileId: initial.target } : {}) },
        }));
        copied = `Copied ${key} to ${file.path}. `;
        if (!fresh(view)) throw new EditorApiError("STALE_REFERENCE", "Source insertion became stale; no citation was inserted. The bibliography copy remains.");
        // Keep the original query range until after the copy, before any workspace refresh.
        view.dispatch({ changes: { from: start, to: context.pos, insert: key },
          selection: { anchor: start + key.length }, userEvent: "input.complete",
          annotations: pickedCompletion.of(completion), scrollIntoView: true });
        await props.document.flush();
        notify(`${copied}Inserted citation key in the existing command.`, true);
        await props.refreshWorkspace();
      } catch (failure) {
        if (!(failure instanceof Error)) throw failure;
        notify(copied + failure.message, copied !== "");
      } finally { copying = false; }
    }
  };
  return { source, invalidate };
}
