import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "@quire/contracts";
import type { ToolsPanelProps } from "../shared";
import { Button } from "../../../ui";
import { createToolsActions } from "./actions";
import { Feedback } from "./Feedback";
import { useTool } from "./use-tool";

/** Linked bibliographies use immutable content, never the editable document transport. */
type Props = ToolsPanelProps & {
  readonly file: FileEntry; readonly label: string;
};
export function MendeleyBibliographyPreview(props: Props) {
  const identity = JSON.stringify([props.workspace.scope, props.workspace.access.actorId,
    props.workspace.access.effectiveRole, props.workspace.requestHeaders, props.document?.file.id,
    props.file.id, props.file.blob, props.file.path]);
  return <Preview key={identity} {...props} />;
}

function Preview(props: Props) {
  const state = useTool(props);
  const [text, setText] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    setText(null);
    return () => { active.current?.abort(); active.current = null; };
  }, [props.client]);
  const close = () => {
    active.current?.abort();
    active.current = null;
    setText(null);
  };
  return <div className="editor-tools__stack">
    <Button disabled={state.busy || !!state.blocked} onClick={() => void state.run(async () => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setText(null);
      try {
        const bytes = await createToolsActions(props).download(props.file, controller.signal);
        if (active.current === controller && !controller.signal.aborted) {
          setText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        }
      } catch (error) { if (!controller.signal.aborted) throw error; }
      finally { if (active.current === controller) active.current = null; }
    })}>{props.label}</Button>
    {state.busy && <Button onClick={close}>Cancel bibliography preview</Button>}
    {text !== null && <section aria-label={`Read-only bibliography: ${props.file.path}`}>
      <p>{props.file.path} is linked and read only. Copy individual references into an editable bibliography to change them.</p>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</pre>
      <Button onClick={close}>Close bibliography preview</Button>
    </section>}
    <Feedback state={state} />
  </div>;
}
