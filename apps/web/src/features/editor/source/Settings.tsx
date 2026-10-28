import { useEffect, useId, useState } from "react";
import type { SelectHTMLAttributes } from "react";
import { endpoints, UserSchema } from "@quire/contracts";
import type { SourcePanelProps } from "../shared";
import { editorValue } from "../shared";
import { Button, Field } from "../../../ui";
import type { SourceCopy, SourceLanguage } from "./locale";

function SourceSelect({ label, children, ...attributes }: Readonly<Omit<SelectHTMLAttributes<HTMLSelectElement>, "id">> & { readonly label: string }) {
  const id = useId();
  return <div className="q-source-setting"><label htmlFor={id}>{label}</label><select {...attributes} id={id}>{children}</select></div>;
}
export function SourceSettings({ props, copy, onLanguage }: {
  readonly props: SourcePanelProps;
  readonly copy: SourceCopy;
  readonly onLanguage: (language: SourceLanguage) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [language, setLanguage] = useState<SourceLanguage>("en");
  const wordsId = useId();
  useEffect(() => {
    const controller = new AbortController();
    void props.client.call(endpoints.me, { params: {}, query: {}, body: undefined }, controller.signal)
      .then(result => setLanguage(editorValue(result).user.interfaceLanguage))
      .catch((cause: unknown) => { if (controller.signal.aborted) return; if (cause instanceof Error) setError(cause.message); else throw cause; });
    return () => controller.abort();
  }, [props.client]);
  const preferences = props.preferences;
  return <form className="q-source-stack" key={preferences.version} onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const customWords = data.get("customWords");
    const body = endpoints.preferencesPatch.input.shape.body.parse({
      expectedVersion: preferences.version, theme: data.get("theme"), bindings: data.get("bindings"),
      fontSize: Number(data.get("fontSize")), fontFamily: data.get("fontFamily"),
      lineHeight: data.get("lineHeight"), dictionary: data.get("dictionary"),
      spellCheck: data.has("spellCheck"), autocomplete: data.has("autocomplete"), autoClose: data.has("autoClose"),
      customWords: (typeof customWords === "string" ? customWords : "").split(/\r?\n/).map(word => word.trim()).filter(Boolean),
    });
    setBusy(true); setError(""); setMessage("");
    void props.client.call(endpoints.preferencesPatch, { params: {}, query: {}, body })
      .then(result => { props.onPreferencesChange(editorValue(result)); setMessage(copy.saved); })
      .catch((cause: unknown) => { if (cause instanceof Error) setError(cause.message); else throw cause; })
      .finally(() => setBusy(false));
  }}>
    <fieldset disabled={busy}><div className="q-source-settings">
      <SourceSelect label="Theme" name="theme" defaultValue={preferences.theme}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></SourceSelect>
      <SourceSelect label="Key bindings" name="bindings" defaultValue={preferences.bindings}><option value="default">Default</option><option value="vim">Vim</option><option value="emacs">Emacs</option></SourceSelect>
      <Field label="Font size (10-24 px)" type="number" name="fontSize" min={10} max={24} defaultValue={preferences.fontSize} required />
      <SourceSelect label="Font family" name="fontFamily" defaultValue={preferences.fontFamily}><option value="plex">IBM Plex Mono</option><option value="system">System monospace</option><option value="serif">Source Serif</option></SourceSelect>
      <SourceSelect label="Line height" name="lineHeight" defaultValue={preferences.lineHeight}><option value="compact">Compact</option><option value="normal">Normal</option><option value="wide">Wide</option></SourceSelect>
      <SourceSelect label="Dictionary" name="dictionary" defaultValue={preferences.dictionary}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="vi">Tiếng Việt</option><option value="zh">中文</option></SourceSelect>
    </div>
      <div className="q-source-options">
        <label><input type="checkbox" name="spellCheck" defaultChecked={preferences.spellCheck} />Spell checking</label>
        <label><input type="checkbox" name="autocomplete" defaultChecked={preferences.autocomplete} />Autocomplete while typing</label>
        <label><input type="checkbox" name="autoClose" defaultChecked={preferences.autoClose} />Close brackets</label>
      </div>
      <div className="q-source-setting"><label htmlFor={wordsId}>Custom dictionary words (one per line)</label><textarea id={wordsId} name="customWords" defaultValue={preferences.customWords.join("\n")} rows={3} /></div>
      <Button type="submit" busy={busy}>{copy.save}</Button>
    </fieldset>
    <SourceSelect label={copy.interfaceLanguage} name="interfaceLanguage" value={language} disabled={busy} onChange={event => {
      const next = UserSchema.unwrap().shape.interfaceLanguage.parse(event.target.value);
      setBusy(true); setError("");
      void props.client.callWithMetadata(endpoints.me, { params: {}, query: {}, body: undefined })
        .then(async response => {
          editorValue(response.result);
          const version = response.metadata.expectedVersion;
          if (version === null) throw new TypeError("Account version missing; reload before changing language.");
          const user = editorValue(await props.client.call(endpoints.profilePatch, {
            params: {}, query: {}, body: { expectedVersion: version, interfaceLanguage: next },
          }));
          setLanguage(user.interfaceLanguage); onLanguage(user.interfaceLanguage);
        })
        .catch((cause: unknown) => { if (cause instanceof Error) setError(cause.message); else throw cause; })
        .finally(() => setBusy(false));
    }}><option value="en">English</option><option value="vi">Tiếng Việt</option><option value="zh">中文</option></SourceSelect>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </form>;
}
