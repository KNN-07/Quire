import { assertNever } from "@quire/contracts";
import type { Preferences } from "@quire/contracts";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { bracketMatching, HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags } from "@lezer/highlight";
import { defaultKeymap, indentWithTab, toggleLineComment } from "@codemirror/commands";
import { closeCompletion, completionKeymap, startCompletion } from "@codemirror/autocomplete";
import type { CompletionSource } from "@codemirror/autocomplete";
import { gotoLine, search, highlightSelectionMatches } from "@codemirror/search";
import { setDiagnostics } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { Doc, UndoManager } from "yjs";
import { yCollab } from "y-codemirror.next";
import type { AuthoringHandle, EditorDocument, SourceSelection } from "../shared";
import { lineOffset, sourceSelection } from "./tex";
import type { TexIndex } from "./tex";
import { texCompletion } from "./completion";
import { preferenceExtensions } from "./preferences";
import { referenceLayout } from "./reference-layout";
import { searchScope } from "./search";
import { collaborativeHistory } from "./bindings";

export type SourceCommand = "bold" | "italic" | "inline-math" | "display-math" | "comment" | "complete" | "line";
export function sourceCommand(view: EditorView, command: SourceCommand): boolean {
  if (view.state.readOnly && command !== "line" && command !== "complete") return false;
  const { from, to } = view.state.selection.main;
  const safe = sourceSelection(view.state.doc.toString(), { anchor: from, head: to });
  const text = view.state.sliceDoc(safe.anchor, safe.head);
  let prefix: string;
  let suffix: string;
  switch (command) {
    case "comment": return toggleLineComment(view);
    case "complete": return startCompletion(view);
    case "line": return gotoLine(view);
    case "bold": prefix = "\\textbf{"; suffix = "}"; break;
    case "italic": prefix = "\\emph{"; suffix = "}"; break;
    case "inline-math": prefix = "\\("; suffix = "\\)"; break;
    case "display-math": prefix = "\\[\n"; suffix = "\n\\]"; break;
    default: return assertNever(command);
  }
  view.dispatch({
    changes: { from: safe.anchor, to: safe.head, insert: prefix + text + suffix },
    selection: { anchor: safe.anchor + prefix.length, head: safe.anchor + prefix.length + text.length },
    scrollIntoView: true, userEvent: "input",
  });
  view.focus();
  return true;
}
export type SourceEditorOptions = {
  readonly parent: HTMLElement;
  readonly document: EditorDocument;
  readonly preferences: Preferences;
  readonly index: () => TexIndex;
  readonly remoteCompletion?: CompletionSource;
  readonly onCompletionContextChange?: () => void;
  readonly selection: SourceSelection;
  readonly onSelection: (selection: SourceSelection) => void;
  readonly onChange: (source: string) => void;
  readonly onFind: () => void;
  /** This private text is never connected to the transport or shared awareness. */
  readonly draft?: { readonly text: string; readonly canEdit: () => boolean };
  readonly sharedUndo?: UndoManager;
  readonly externalInsertionBlocked?: () => boolean;
};
const highlighting = HighlightStyle.define([
  { tag: [tags.keyword, tags.tagName], color: "var(--q-syntax-command)" },
  { tag: [tags.string, tags.brace], color: "var(--q-syntax-string)" },
  { tag: [tags.atom, tags.number], color: "var(--q-syntax-math)" },
  { tag: tags.comment, color: "var(--q-syntax-comment)", fontStyle: "italic" },
]);

/** Own the view and undo manager, never the shared Y.Doc or transport. */
export function createSourceEditor(options: SourceEditorOptions) {
  const preferences = new Compartment();
  const access = new Compartment();
  const privateDoc = options.draft ? new Doc() : null;
  const boundSource = privateDoc?.getText("source") ?? options.document.source;
  if (privateDoc && options.draft) boundSource.insert(0, options.draft.text);
  const undo = privateDoc ? new UndoManager(boundSource) : options.sharedUndo ?? new UndoManager(boundSource);
  const undoCommand = (target: EditorView) => {
    if (!target.state.readOnly) undo.undo();
    return true;
  };
  const redoCommand = (target: EditorView) => {
    if (!target.state.readOnly) undo.redo();
    return true;
  };
  const completion = [texCompletion(options.index), ...(options.remoteCompletion ? [options.remoteCompletion] : [])];
  const source = boundSource.toJSON();
  const isReadOnly = () => options.draft ? !options.draft.canEdit() : options.document.getSnapshot().readOnly;
  const editable = () => [
    EditorState.readOnly.of(isReadOnly()),
    EditorView.editable.of(!isReadOnly()),
  ];
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: source, selection: sourceSelection(source, options.selection),
      extensions: [
        // Keep CR bytes in CRLF files; Y.Text offsets must equal CodeMirror offsets.
        EditorState.lineSeparator.of("\n"),
        lineNumbers(), highlightSpecialChars(), drawSelection(), dropCursor(), highlightActiveLine(),
        StreamLanguage.define(stex), syntaxHighlighting(highlighting), bracketMatching(),
        search({ top: true }), searchScope, highlightSelectionMatches(), EditorView.lineWrapping,
        preferences.of(preferenceExtensions(options.preferences, completion)), access.of(editable()),
        referenceLayout,
        Prec.highest(EditorView.domEventHandlers({
          keydown(event, target) {
            if (event.key !== "Escape" || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
            options.onCompletionContextChange?.();
            return closeCompletion(target);
          },
        })),
        EditorView.domEventHandlers({
          beforeinput(event, target) {
            if (event instanceof InputEvent && target.state.readOnly
              && (event.inputType === "historyUndo" || event.inputType === "historyRedo")) {
              event.preventDefault();
              return true;
            }
            if (!(event instanceof InputEvent) || event.isComposing || target.state.readOnly
              || event.inputType !== "insertText" || event.data === null || !event.data.includes("\n")) return false;
            // Preserve the raw multiline insertion before contenteditable reconciles
            // a leading newline against its trailing empty-line placeholder.
            event.preventDefault();
            target.dispatch({ ...target.state.replaceSelection(event.data),
              userEvent: "input.type", scrollIntoView: true });
            return true;
          },
        }),
        collaborativeHistory(undo),
        EditorState.transactionExtender.of(transaction => {
          if (transaction.isUserEvent("input.paste")) undo.stopCapturing();
          return null;
        }),
        yCollab(boundSource, privateDoc ? null : options.document.awareness, { undoManager: undo }),
        Prec.highest(keymap.of([
          { key: "Mod-f", run: () => { options.onFind(); return true; } },
          { key: "Ctrl-h", mac: "Mod-Alt-f", run: () => { options.onFind(); return true; } },
          { key: "Mod-b", run: target => sourceCommand(target, "bold") },
          { key: "Mod-i", run: target => sourceCommand(target, "italic") },
          { key: "Mod-/", run: toggleLineComment },
          { key: "Ctrl-Space", mac: "Ctrl-Space", run: startCompletion },
          { key: "Alt-Space", mac: "Alt-Space", run: startCompletion },
          { key: "Mod-z", run: undoCommand, shift: redoCommand, preventDefault: true },
          { key: "Mod-y", run: redoCommand, preventDefault: true },
        ])),
        keymap.of([...completionKeymap, ...defaultKeymap, indentWithTab]),
        EditorView.contentAttributes.of({ "aria-label": `Source: ${options.document.file.path}` }),
        EditorView.updateListener.of(update => {
          if (update.docChanged || update.selectionSet) options.onCompletionContextChange?.();
          if (update.transactions.some(transaction => transaction.isUserEvent("input.paste"))) {
            undo.stopCapturing();
          }
          if (update.selectionSet) options.onSelection({ anchor: update.state.selection.main.anchor, head: update.state.selection.main.head });
          if (update.docChanged) options.onChange(update.state.doc.toString());
        }),
      ],
    }),
  });
  let active = true;
  let readOnly = isReadOnly();
  const unsubscribe = options.document.subscribe(() => {
    const next = isReadOnly();
    if (next === readOnly) return;
    readOnly = next;
    // Yjs publishes saving synchronously inside CodeMirror's update transaction.
    queueMicrotask(() => { if (active) view.dispatch({ effects: access.reconfigure(editable()) }); });
  });
  const handle: AuthoringHandle = {
    focus: () => view.focus(),
    select: selection => view.dispatch({ selection: sourceSelection(view.state.doc.toString(), selection), scrollIntoView: true }),
    reveal: location => {
      if (location.fileId !== options.document.file.id) return;
      const position = lineOffset(view.state.doc.toString(), location);
      view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
      view.focus();
    },
    replaceSelection: text => {
      if (!active) throw new Error("The source editor changed. Reopen the insertion tool before making changes.");
      if (options.draft || options.externalInsertionBlocked?.()) throw new Error("External and structural insertions are unavailable while Track changes is on. Type or paste text in Source to propose it.");
      if (options.document.getSnapshot().readOnly) return;
      const safe = sourceSelection(view.state.doc.toString(), view.state.selection.main);
      const from = Math.min(safe.anchor, safe.head);
      const to = Math.max(safe.anchor, safe.head);
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input" });
    },
  };
  return {
    view, handle,
    access: () => view.dispatch({ effects: access.reconfigure(editable()) }),
    preferences: (next: Preferences) => view.dispatch({ effects: preferences.reconfigure(preferenceExtensions(next, completion)) }),
    diagnostics: (issues: readonly Diagnostic[]) => view.dispatch(setDiagnostics(view.state, issues)),
    destroy: () => {
      active = false; unsubscribe(); view.destroy();
      if (privateDoc || !options.sharedUndo) undo.destroy();
      privateDoc?.destroy();
    },
  };
}
export type SourceEditor = ReturnType<typeof createSourceEditor>;
