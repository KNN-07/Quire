import type { z } from "zod";
import { EngineSchema } from "@quire/contracts";
import type { Project, endpoints } from "@quire/contracts";
import { Field } from "../../ui";

type Admission = z.output<typeof endpoints.environmentsAdmission.output>[number];
export function CreationSettings(props: {
  readonly blank: boolean; readonly disabled: boolean;
  readonly engine: Project["settings"]["engine"] | undefined;
  readonly environmentId: string | undefined;
  readonly compatible: readonly Admission[]; readonly selected: Admission | undefined;
  readonly mainPath: string;
  readonly onEngine: (engine: Project["settings"]["engine"]) => void;
  readonly onEnvironment: (id: string) => void; readonly onMainPath: (path: string) => void;
}) {
  const { engine, selected } = props;
  return <fieldset className="p-form-grid" disabled={props.disabled}>
    <legend>Compiler and main document</legend>
    <label className="p-field">Compiler<select aria-label="Compiler" value={engine ?? ""}
      onChange={event => props.onEngine(EngineSchema.parse(event.target.value))}>
      {!engine && <option value="">Loading saved compiler</option>}
      <option value="pdflatex">pdfLaTeX</option><option value="latex">LaTeX</option>
      <option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option>
      {!props.blank && <option value="plain">Plain TeX</option>}
      {props.blank && engine === "plain" && <option value="plain" disabled>Plain TeX (requires imported plain source)</option>}
    </select></label>
    <label className="p-field">TeX Live version<select aria-label="TeX Live version" value={props.environmentId ?? ""}
      onChange={event => props.onEnvironment(event.target.value)}>
      {!props.compatible.some(item => item.environment.id === props.environmentId) &&
        <option value={props.environmentId ?? ""}>Choose a compatible environment</option>}
      {props.compatible.map(item => <option key={item.environment.id} value={item.environment.id} disabled={!item.selectable}>
        {item.environment.label}{!item.selectable ? item.probe !== "ready" ? " (toolchain unavailable)" : " (signed admission required)" : ""}
      </option>)}
    </select></label>
    {!props.blank && <Field label="Main document path (optional)" value={props.mainPath}
      placeholder="main.tex" hint="Exact path inside the template or import. Leave empty to discover a compatible main."
      onChange={event => props.onMainPath(event.target.value)} />}
    <p className="p-full">{selected?.execution.state === "admitted"
      ? "Toolchain probes passed. Signed execution admitted."
      : selected?.execution.state === "unmanaged"
        ? "Toolchain probes passed. This deployment is not controlled by signed installation admission."
        : "No usable environment is selected. Ask an operator to review its toolchain and signed worker admission."}</p>
    {engine && !selected && <p role="alert" className="p-full">{props.blank && engine === "plain"
      ? "Your saved compiler is Plain TeX, but blank and example projects contain LaTeX source. Choose a LaTeX compiler or import a plain TeX project."
      : "Choose an executable environment compatible with the selected compiler."}</p>}
  </fieldset>;
}
