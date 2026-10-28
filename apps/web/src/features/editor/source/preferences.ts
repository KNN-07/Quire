import { assertNever } from "@quire/contracts";
import type { Preferences } from "@quire/contracts";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { vim } from "@replit/codemirror-vim";
import { emacs } from "@replit/codemirror-emacs";
import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { CompletionSource } from "@codemirror/autocomplete";

export function preferenceExtensions(preferences: Preferences, completion: CompletionSource): Extension {
  let bindings: Extension;
  switch (preferences.bindings) {
    case "default": bindings = []; break;
    case "vim": bindings = vim(); break;
    case "emacs": bindings = emacs(); break;
    default: return assertNever(preferences.bindings);
  }
  const family = { plex: "var(--q-font-mono)", system: "ui-monospace, monospace", serif: "var(--q-font-serif)" };
  const height = { compact: "1.4", normal: "1.7", wide: "2" };
  return [
    bindings,
    autocompletion({ override: [completion], activateOnTyping: preferences.autocomplete }),
    preferences.autoClose ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
    EditorState.tabSize.of(2),
    EditorView.contentAttributes.of({ spellcheck: "false", lang: preferences.dictionary }),
    EditorView.theme({
      "&": { backgroundColor: "var(--q-surface)", color: "var(--q-ink)", height: "100%" },
      ".cm-scroller": { fontFamily: family[preferences.fontFamily], fontSize: `${preferences.fontSize}px`, lineHeight: height[preferences.lineHeight], overflow: "auto" },
      ".cm-content": { caretColor: "var(--q-ink)", padding: "var(--q-space-3) 0" },
      ".cm-gutters": { backgroundColor: "var(--q-sidebar)", color: "var(--q-tertiary)", borderColor: "var(--q-border)" },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--q-active-line)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--q-selected)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--q-ink)" },
      ".cm-tooltip": { backgroundColor: "var(--q-surface)", color: "var(--q-ink)", borderColor: "var(--q-border)" },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--q-selected)", color: "var(--q-ink)" },
      ".cm-searchMatch": { backgroundColor: "var(--q-match)", outline: "1px solid var(--q-control-border)" },
      ".cm-searchMatch-selected": { backgroundColor: "var(--q-match)" },
      "&.cm-focused": { outline: "2px solid var(--q-control-border)", outlineOffset: "-2px" },
    }),
  ];
}
