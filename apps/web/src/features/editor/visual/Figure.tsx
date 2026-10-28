import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import { z } from "zod";
import { Button, Field } from "../../../ui";
import { editorValue } from "../shared";
import type { VisualPanelProps, SourceEdit } from "../shared";
import type { ParsedLatex, VisualNode } from "./model";
import { figureShape } from "./structures";
import { fieldEdit, withPackage } from "./commands";
import { escapeText, VisualEditError } from "./model";

export type FigureProps = {
  readonly editor: VisualPanelProps;
  readonly parsed: ParsedLatex;
  readonly node: VisualNode;
  readonly apply: (edits: readonly SourceEdit[]) => void;
  readonly report: (error: Error) => void;
};
const FigureFields = z.object({
  caption: z.string(),
  label: z.string().regex(/^[a-zA-Z0-9:._-]*$/, "Use a label without spaces."),
  width: z.string().regex(/^(?:0?\.\d+|1)(?:\\(?:textwidth|linewidth))$|^\d+(?:\.\d+)?(?:cm|mm|in|pt)$/,
    "Use a length such as 0.8\\linewidth or 8cm."),
});
export function Figure({ editor, parsed, node, apply, report }: FigureProps) {
  const shape = figureShape(parsed.source, node);
  const path = shape ? parsed.source.slice(shape.path.from, shape.path.to) : "";
  const [preview, setPreview] = useState<{ readonly url: string; readonly path: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const file = editor.workspace.files.find(entry => entry.path === path);
  useEffect(() => {
    setPreview(null); setFailure(null);
    if (!file || !file.mime.startsWith("image/")) return undefined;
    const abort = new AbortController();
    let url: string | undefined;
    void editor.client.call(endpoints.fileContent, {
      params: { p: editor.workspace.scope.projectId, f: file.id },
      query: { branch: editor.workspace.scope.branch }, body: undefined,
      headers: editor.workspace.requestHeaders,
    }, abort.signal).then(result => {
      const bytes = editorValue(result);
      if (abort.signal.aborted) return;
      url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: file.mime }));
      setPreview({ url, path });
      setFailure(null);
    }).catch((error: unknown) => {
      if (abort.signal.aborted) return;
      if (!(error instanceof Error)) throw error;
      setFailure(error.message);
    });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [editor.client, editor.workspace.scope.projectId, editor.workspace.scope.branch,
    editor.workspace.requestHeaders, file, path]);
  if (!shape) return <p>Complex figure: edit its source below.</p>;
  const caption = shape.caption ? parsed.source.slice(shape.caption.from, shape.caption.to) : "";
  const label = shape.label ? parsed.source.slice(shape.label.from, shape.label.to) : "";
  const options = shape.options ? parsed.source.slice(shape.options.from, shape.options.to) : "";
  const width = /(?:^|,)\s*width=([^,]+)/.exec(options)?.[1] ?? "0.8\\linewidth";
  const previewMessage = !file ? `Image not found: ${path}` : file.mime.startsWith("image/")
    ? "Loading image…" : `Preview unavailable for ${file.mime}.`;
  return <figure className="q-visual-figure">
    {preview?.path === path
      ? <img src={preview.url} width={640} height={360} alt={caption || path}
        onError={() => { setFailure("Image could not be decoded."); setPreview(null); }} />
      : <p>{failure ?? previewMessage}</p>}
    <figcaption>{caption || path}</figcaption>
    <form onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const values = FigureFields.safeParse(Object.fromEntries(data));
      if (!values.success) {
        report(new VisualEditError("INVALID_INPUT", values.error.issues.map(issue => issue.message).join(" ")));
        return;
      }
      const edits: SourceEdit[] = [];
      const next = values.data;
      if (shape.caption) edits.push(fieldEdit(parsed.source, shape.caption, { text: next.caption, literal: false }));
      if (shape.label) edits.push({ ...shape.label, insert: next.label });
      const additions = `${shape.caption ? "" : `\n\\caption{${escapeText(next.caption)}}`}${shape.label ? "" : `\n\\label{${next.label}}`}`;
      if (additions) edits.push({ from: node.content.to, to: node.content.to, insert: additions + "\n" });
      const nextOptions = /(?:^|,)\s*width=/.test(options)
        ? options.replace(/((?:^|,)\s*width=)[^,]+/, `$1${next.width}`)
        : `${options}${options ? "," : ""}width=${next.width}`;
      const widthEdit = shape.options ? { ...shape.options, insert: nextOptions }
        : { from: shape.path.from - 1, to: shape.path.from - 1, insert: `[width=${next.width}]` };
      apply([...withPackage(parsed, widthEdit, "graphicx"), ...edits]);
    }}>
      <Field label="Figure caption" name="caption" defaultValue={caption} readOnly={editor.document.getSnapshot().readOnly} />
      <Field label="Figure label" name="label" defaultValue={label} readOnly={editor.document.getSnapshot().readOnly} />
      <Field label="Figure width" name="width" defaultValue={width} readOnly={editor.document.getSnapshot().readOnly} />
      <Button type="submit" disabled={editor.document.getSnapshot().readOnly}>Apply figure</Button>
    </form>
  </figure>;
}
