import { useLayoutEffect, useRef, useState } from "react";
import { contextualLanguageTools, languageSelectionEligible } from "@quire/contracts";
import { Button } from "../../../ui";
import type { SourcePanelProps } from "../shared";
import type { SourceEditor } from "./editor";
import { tools } from "../assistant/tools";

/** Source only captures context; the Assistant still requires Send and reviewed acceptance. */
export function LanguageActions({ props, editor, source, blocked, shortcut }: {
  readonly props: SourcePanelProps; readonly editor: SourceEditor | null; readonly source: string;
  readonly blocked: boolean; readonly shortcut: { readonly key: string; readonly anchor: number; readonly head: number; readonly text: string } | null;
}) {
  const from = Math.min(props.selection.anchor, props.selection.head);
  const to = Math.max(props.selection.anchor, props.selection.head);
  const manual = shortcut?.anchor === props.selection.anchor && shortcut.head === props.selection.head && shortcut.text === source;
  const identity = `${from}:${to}:${source}:${shortcut?.key}`;
  const [dismissed, dismiss] = useState<string | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const menu = useRef<HTMLDivElement>(null);
  const visible = props.preferences.languageEnabled && !blocked && props.onLanguageAction
    && dismissed !== identity && (manual || props.preferences.languageFloatingMenu && from !== to);
  useLayoutEffect(() => {
    if (!visible || !editor || !menu.current) return undefined;
    const place = () => {
      const point = editor.view.coordsAtPos(to);
      if (!point || !menu.current) return;
      const box = menu.current.getBoundingClientRect();
      setPosition({
        top: Math.max(8, Math.min(point.bottom + 8, innerHeight - box.height - 8)),
        left: Math.max(8, Math.min(point.left, innerWidth - box.width - 8)),
      });
    };
    place();
    if (manual) menu.current.querySelector("button")?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [visible, editor, identity, shortcut]);
  if (!visible) return null;
  const selection = { from, to, text: source.slice(from, to) };
  const eligible = contextualLanguageTools.filter(tool => languageSelectionEligible(tool, selection)
    && (tool !== "inline-completion" || props.preferences.inlineCompletion));
  return <div ref={menu} className="q-language-actions" role="toolbar" aria-label="Contextual language actions"
    style={position} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); dismiss(identity); editor?.handle.focus(); }
    }}>
    {eligible.map(tool => <Button key={tool} size="small" onClick={() => {
      props.onLanguageAction?.({ key: crypto.randomUUID(), fileId: props.document.file.id, tool, ...selection });
      dismiss(identity);
    }}>{tools[tool]}</Button>)}
    {!eligible.length && <span>Enable inline completion in AI preferences to complete at the caret.</span>}
    <Button size="small" aria-label="Close language actions" onClick={() => dismiss(identity)}>Close</Button>
  </div>;
}
