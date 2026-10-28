import { Button } from "../../../ui";
import type { EditorLayout } from "../shared";

export type PdfLayoutControlsProps = {
  readonly layout: EditorLayout;
  readonly onChange: (layout: EditorLayout) => void;
};
/** Geometry stays with assembly; each control selects a real shared layout value. */
export function PdfLayoutControls({ layout, onChange }: PdfLayoutControlsProps) {
  return <div className="q-pdf-toolbar" role="group" aria-label="Workspace layout">
    {([
      { value: "source", label: "Source" }, { value: "split", label: "Split" },
      { value: "visual", label: "Visual" }, { value: "pdf", label: "PDF" },
      { value: "stacked", label: "Stacked" },
    ] as const).map(item => <Button key={item.value} aria-pressed={layout === item.value}
      onClick={() => onChange(item.value)}>{item.label}</Button>)}
  </div>;
}
