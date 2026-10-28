import { EditorView, ViewPlugin } from "@codemirror/view";
import { Vim } from "@replit/codemirror-vim";
import { EmacsHandler } from "@replit/codemirror-emacs";
import type { UndoManager } from "yjs";

const histories = new WeakMap<EditorView, UndoManager>();
function history(view: EditorView): UndoManager {
  const manager = histories.get(view);
  if (!manager) throw new TypeError("Collaborative source history is not attached to this view");
  return manager;
}
Vim.defineAction("quireUndo", (cm, args) => {
  const view = EditorView.findFromDOM(cm.getInputField());
  if (!view) throw new TypeError("Vim source view is missing");
  for (let repeat = 0; repeat < args.repeat; repeat++) history(view).undo();
});
Vim.defineAction("quireRedo", (cm, args) => {
  const view = EditorView.findFromDOM(cm.getInputField());
  if (!view) throw new TypeError("Vim source view is missing");
  for (let repeat = 0; repeat < args.repeat; repeat++) history(view).redo();
});
Vim.mapCommand("u", "action", "quireUndo", {}, { context: "normal" });
Vim.mapCommand("<C-r>", "action", "quireRedo", {}, { context: "normal" });
EmacsHandler.bindKey("C-x u|C-/", (view: EditorView) => { history(view).undo(); });

/** Both maintained emulations use the same Yjs history as the standard keymap. */
export function collaborativeHistory(manager: UndoManager) {
  return ViewPlugin.define(view => {
    histories.set(view, manager);
    return { destroy: () => { histories.delete(view); } };
  });
}
