import { useState } from "react";
import { z } from "zod";
import { assertNever } from "@quire/contracts";
import type { ToolsPanelProps } from "../shared";
import { FilesPanel } from "./FilesPanel";
import type { FilesPanelProps } from "./FilesPanel";
import { SearchPanel } from "./SearchPanel";
import { SymbolsPanel } from "./SymbolsPanel";
import { BibliographyPanel } from "./BibliographyPanel";
import { ProjectSettings } from "./ProjectSettings";
import { InterfacePreferences } from "./InterfacePreferences";
import type { PreferencesCallbacks } from "./InterfacePreferences";
import { FigurePanel } from "./FigurePanel";
import { ProviderState } from "./ProviderState";
import { PythonPanel } from "./PythonPanel";
import "./tools.css";

const PanelSchema = z.enum(["files", "search", "symbols", "bibliography", "figure", "settings", "preferences", "providers", "python"]);
export type ToolPanel = z.infer<typeof PanelSchema>;
export type EditorToolsProps = ToolsPanelProps & PreferencesCallbacks & {
  readonly panel?: ToolPanel;
  readonly onPanelChange?: (panel: ToolPanel) => void;
  readonly filesPresentation?: FilesPanelProps["presentation"];
};
export function ToolsPanel(props: EditorToolsProps) {
  const [internal, setInternal] = useState<ToolPanel>("files");
  const panel = props.panel ?? internal;
  let content;
  switch (panel) {
    case "files": content = <FilesPanel {...props} presentation={props.filesPresentation ?? "standalone"} />; break;
    case "search": content = <SearchPanel {...props} />; break;
    case "symbols": content = <SymbolsPanel {...props} />; break;
    case "bibliography": content = <BibliographyPanel {...props} />; break;
    case "figure": content = <FigurePanel {...props} />; break;
    case "settings": content = <ProjectSettings {...props} />; break;
    case "preferences": content = <InterfacePreferences {...props} />; break;
    case "providers": content = <ProviderState {...props} />; break;
    case "python": content = <PythonPanel {...props} />; break;
    default: assertNever(panel);
  }
  return <aside className="editor-tools" aria-label="Editor tools" data-presentation={props.filesPresentation ?? "standalone"} data-panel={panel}>
    <label className="editor-tools__chooser"><span className={props.filesPresentation === "compact" ? "q-sr-only" : undefined}>Editor tool</span><select aria-label="Editor tool" value={panel} onChange={event => {
      const next = PanelSchema.parse(event.target.value); setInternal(next); props.onPanelChange?.(next);
    }}>
      <option value="files">Files</option><option value="search">Project search</option><option value="symbols">Symbols</option>
      <option value="bibliography">Bibliography & Library</option><option value="figure">Insert figure</option>
      <option value="settings">Project settings</option><option value="preferences">Interface preferences</option>
      <option value="providers">Provider configuration</option><option value="python">Browser Python</option>
    </select></label>
    <div className="editor-tools__body">{content}</div>
  </aside>;
}
