import { assertNever } from "@quire/contracts";
import { Button } from "../../../ui";
import type { SourceEdit, VisualPanelProps } from "../shared";
import { VisualEditError } from "./model";
import { fieldEdit } from "./commands";
import type { Interval, ParsedLatex, VisualNode } from "./model";
import { tableShape } from "./structures";
import { Figure } from "./Figure";

export type NodeProps = {
  readonly editor: VisualPanelProps;
  readonly parsed: ParsedLatex;
  readonly node: VisualNode;
  readonly apply: (edits: readonly SourceEdit[]) => void;
  readonly report: (error: Error) => void;
};
export function SourceField({ context, range, label, literal = false }: {
  readonly context: NodeProps; readonly range: Interval; readonly label: string; readonly literal?: boolean;
}) {
  const value = context.parsed.source.slice(range.from, range.to);
  return <textarea aria-label={label} className={`q-visual-input${literal ? " q-visual-literal" : ""}`}
    data-source-from={range.from} data-source-to={range.to}
    value={value} rows={Math.max(1, value.split("\n").length)}
    readOnly={context.editor.document.getSnapshot().readOnly}
    onSelect={event => {
      const field = event.currentTarget;
      const start = range.from + field.selectionStart;
      const end = range.from + field.selectionEnd;
      context.editor.onSelectionChange({
        anchor: field.selectionDirection === "backward" ? end : start,
        head: field.selectionDirection === "backward" ? start : end,
      });
    }}
    onChange={event => context.apply([fieldEdit(context.parsed.source, range,
      { text: event.currentTarget.value, literal })])} />;
}
export function Nodes(props: NodeProps) {
  const { node, parsed } = props;
  const children = node.children.map(child => <Nodes {...props} key={`${child.from}:${child.kind}`} node={child} />);
  switch (node.kind) {
    case "text":
      return parsed.source.slice(node.from, node.to).trim()
        ? <SourceField context={props} range={node.content} label="Paragraph text" /> : null;
    case "paragraph": return <div className="q-visual-paragraph">{children}</div>;
    case "heading": return <div className="q-visual-heading" role="group" aria-label={`${node.command} heading`}>
      {children}
    </div>;
    case "bold": return <strong className="q-visual-bold">{children}</strong>;
    case "italic": return <em className="q-visual-italic">{children}</em>;
    case "list": return node.command === "enumerate" ? <ol>{children}</ol> : <ul>{children}</ul>;
    case "item": return <li>{children}</li>;
    case "math": return <label className="q-visual-math">Math (LaTeX)
      <SourceField context={props} range={node.content} label="Math expression" literal />
    </label>;
    case "include": {
      const path = parsed.source.slice(node.content.from, node.content.to);
      const file = props.editor.workspace.files.find(entry => entry.path === path || entry.path === `${path}.tex`);
      return <div className="q-visual-command"><label>{node.command}
        <SourceField context={props} range={node.content} label={`${node.command} target`} literal /></label>
        {file ? <Button disabled={props.editor.document.getSnapshot().persistence.kind === "offline"}
          onClick={() => {
            void props.editor.document.flush(AbortSignal.timeout(30_000))
              .then(() => props.editor.navigation.openFile(file.id))
              .catch((failure: unknown) => {
                if (!(failure instanceof Error)) throw failure;
                props.report(failure);
              });
          }}>Open {file.path}</Button> : <span>Included file is not in this project.</span>}
      </div>;
    }
    case "citation": case "reference":
      return <label className="q-visual-command">{node.command}
        <SourceField context={props} range={node.content} label={`${node.command} target`} literal />
      </label>;
    case "island":
      return <details className="q-visual-island">
        <summary>{node.command === "comment" ? "Comment" : `Source island${node.command ? ` · ${node.command}` : ""}`}</summary>
        <SourceField context={props} range={node} label="Preserved LaTeX source" literal />
      </details>;
    case "table": {
      const shape = tableShape(parsed.source, node);
      if (!shape) return <details open className="q-visual-island"><summary>Complex table source</summary>
        <SourceField context={props} range={node} label="Table source" literal /></details>;
      return <div className="q-visual-table"><div className="q-visual-table-scroll" role="region"
        aria-label="Table cells" tabIndex={0}><table style={{
          minInlineSize: `calc(var(--q-space-15) * ${shape.rows[0]?.length ?? 1})`,
        }}><caption>Table</caption><tbody>
        {shape.rows.map((row, index) => <tr key={index}>{row.map(cell => <td key={cell.from}>
          <SourceField context={props} range={cell} label={`Row ${index + 1} column ${row.indexOf(cell) + 1}`} literal />
        </td>)}</tr>)}
      </tbody></table></div>
      <label>Column alignment (l, c, r)
        <input className="q-input" aria-label="Column alignment" value={parsed.source.slice(shape.columns.from, shape.columns.to)}
          readOnly={props.editor.document.getSnapshot().readOnly}
          onChange={event => {
            const value = event.currentTarget.value;
            const count = value.replace(/[^lcr]/g, "").length;
            if (/^[lcr| ]+$/.test(value) && count === (shape.rows[0]?.length ?? count)) {
              props.apply([{ ...shape.columns, insert: value }]);
            } else props.report(new VisualEditError("INVALID_INPUT", "Keep one l, c or r alignment per table column."));
          }} />
      </label></div>;
    }
    case "figure": return <><Figure editor={props.editor} parsed={parsed} node={node} apply={props.apply} report={props.report} />
      <details><summary>Figure source</summary><SourceField context={props} range={node} label="Figure source" literal /></details></>;
    default: return assertNever(node.kind);
  }
}
