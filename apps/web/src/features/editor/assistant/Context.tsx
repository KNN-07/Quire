import { IdSchema, endpoints } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { editorValue } from "../shared";
import type { AssistantState } from "./use-assistant";

export type ContextChoice = {
  readonly files: readonly Id[];
  readonly range: boolean;
  readonly diagnostic: string;
  readonly diagnosticConsent: boolean;
  readonly imageConsent: boolean;
  readonly images: readonly Id[];
};
export const emptyContext: ContextChoice = {
  files: [], range: false, diagnostic: "", diagnosticConsent: false, imageConsent: false, images: [],
};
export function AssistantContext({ state, choice, change }: {
  readonly state: AssistantState;
  readonly choice: ContextChoice;
  readonly change: (next: ContextChoice) => void;
}) {
  const from = Math.min(state.selection.anchor, state.selection.head);
  const to = Math.max(state.selection.anchor, state.selection.head);
  const fileCount = choice.files.length + (choice.range && state.document && !choice.files.includes(state.document.file.id) ? 1 : 0);
  return <details className="qa-assistant__context" open={state.diagnosticFix ? true : undefined}>
    <summary>Context · {fileCount} files{choice.range ? ` · UTF-16 ${from}–${to}` : ""}</summary>
    <p>Only checked files are sent. An enabled selection sends just that range for the active file.</p>
    <fieldset><legend>Selected files</legend>
      {state.workspace.files.filter(file => file.kind === "file" && file.editable).map(file =>
        <label className="qa-assistant__check" key={file.id}><input type="checkbox" checked={choice.files.includes(file.id)}
          onChange={event => change({ ...choice, files: event.target.checked
            ? [...choice.files, file.id] : choice.files.filter(id => id !== file.id) })} />{file.path}</label>)}
    </fieldset>
    <label className="qa-assistant__check"><input type="checkbox" checked={choice.range}
      disabled={!state.document || from === to}
      onChange={event => change({ ...choice, range: event.target.checked })} />Send active UTF-16 range {from}–{to} in {state.document?.file.path ?? "no active file"}</label>
    {choice.range && state.document && <pre aria-label="Selected text">{state.document.source.toJSON().slice(from, to)}</pre>}
    <label>Compile diagnostic<select aria-label="Compile diagnostic" value={choice.diagnostic}
      disabled={Boolean(state.diagnosticFix)}
      onChange={event => change({ ...choice, diagnostic: event.target.value, diagnosticConsent: false })}>
      <option value="">No diagnostic</option>
      {state.diagnostics.map(item => <option key={item.id} value={item.id}>{item.severity}: {item.message}</option>)}
    </select></label>
    {state.diagnosticFix && <p>Clear diagnostic context to choose a different compiler diagnostic.</p>}
    <label className="qa-assistant__check"><input type="checkbox" checked={choice.diagnosticConsent}
      onChange={event => change({ ...choice, diagnosticConsent: event.target.checked })} />Send the selected diagnostic and its recorded log excerpt</label>
    <label className="qa-assistant__check"><input type="checkbox" checked={choice.imageConsent}
      onChange={event => change({ ...choice, imageConsent: event.target.checked,
        images: event.target.checked ? choice.images : [] })} />Send attached images to the configured provider</label>
    <label>Attach PNG or JPEG (10 MiB total)<input type="file" accept="image/png,image/jpeg"
      disabled={!choice.imageConsent || state.busy || !state.online}
      onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        event.target.value = "";
        void state.execute(async () => {
          if (file.size > 10 * 1024 * 1024) throw new TypeError("Image exceeds 10 MiB");
          if (file.type !== "image/png" && file.type !== "image/jpeg") throw new TypeError("PNG or JPEG required");
          const dataBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => {
              if (typeof reader.result !== "string") { reject(new TypeError("Invalid image data")); return; }
              resolve(reader.result.slice(reader.result.indexOf(",") + 1));
            };
            reader.readAsDataURL(file);
          });
          const image = editorValue(await state.client.call(endpoints.aiImageCreate, {
            params: state.params, query: {}, headers: state.headers, body: { mime: file.type, dataBase64 },
          }, state.signal));
          change({ ...choice, images: [...choice.images, IdSchema.parse(image.id)] });
          state.setNotice(`Attached ${file.name} · ${image.bytes} bytes`);
        });
      }} /></label>
    <p>{choice.images.length} images attached. Uncheck image consent to remove them from the next request.</p>
  </details>;
}
