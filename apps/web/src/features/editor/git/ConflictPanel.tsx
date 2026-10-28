import { useEffect, useState } from "react";
import { Button } from "../../../ui";
import type { GitConflict, GitResolution } from "./types";

type Choice = "text" | "ours" | "theirs" | "delete";
type Props = {
  readonly conflict: GitConflict;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onResolve: (resolutions: readonly GitResolution[]) => void;
};

export function ConflictPanel({ conflict, busy, onCancel, onResolve }: Props) {
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    setChoices(Object.fromEntries(conflict.files.map(file => [file.path, file.binary ? "ours" : "text"])));
    setTexts(Object.fromEntries(conflict.files.map(file => [file.path, file.merged ?? file.ours ?? file.theirs ?? ""])));
  }, [conflict]);
  return <section className="git-conflicts" aria-labelledby="git-conflicts-title">
    <header><div><h2 id="git-conflicts-title">Resolve merge conflicts</h2>
      <p>{conflict.from} cannot merge automatically into {conflict.scope.branch}. Each file needs an explicit result.</p></div>
      <Button onClick={onCancel}>Close</Button></header>
    <div className="git-conflicts__files">
      {conflict.files.map(file => {
        const choice = choices[file.path] ?? (file.binary ? "ours" : "text");
        return <article key={file.path}>
          <div className="git-conflicts__file-header"><strong>{file.path}</strong>
            <label>Resolution
              <select value={choice} onChange={event => {
                const value = event.currentTarget.value;
                const next: Choice = value === "theirs" || value === "delete" || value === "text" ? value : "ours";
                setChoices(current => ({ ...current, [file.path]: next }));
              }}>
                {!file.binary && <option value="text">Edit merged text</option>}
                <option value="ours">Keep current branch</option>
                <option value="theirs">Use {conflict.from}</option>
                <option value="delete">Delete file</option>
              </select>
            </label>
          </div>
          {choice === "text" && <label className="git-conflicts__editor">Resolved source
            <textarea value={texts[file.path] ?? ""} onChange={event =>
              setTexts(current => ({ ...current, [file.path]: event.currentTarget.value }))} />
          </label>}
          {file.binary && <p>Binary conflict: choose one side or delete the file.</p>}
        </article>;
      })}
    </div>
    <footer><Button onClick={onCancel}>Cancel</Button><Button data-testid="git-complete-merge" variant="primary" busy={busy}
      onClick={() => onResolve(conflict.files.map(file => {
        const choice = choices[file.path] ?? (file.binary ? "ours" : "text");
        return choice === "text"
          ? { path: file.path, choice, text: texts[file.path] ?? "" }
          : { path: file.path, choice };
      }))}>Complete merge</Button></footer>
  </section>;
}
