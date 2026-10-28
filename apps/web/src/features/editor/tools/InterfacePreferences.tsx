import { useEffect, useState } from "react";
import { PreferencesSchema, UserSchema, endpoints } from "@quire/contracts";
import type { Preferences, ResponseOf } from "@quire/contracts";
import { editorValue } from "../shared";
import type { ToolsPanelProps } from "../shared";
import { Button } from "../../../ui";
import { Feedback } from "./Feedback";
import { useTool } from "./use-tool";

export type PreferencesCallbacks = {
  readonly onPreferencesChange?: (preferences: Preferences) => void;
  readonly onSessionChange?: () => Promise<void>;
};
export function InterfacePreferences(props: ToolsPanelProps & PreferencesCallbacks) {
  const state = useTool(props);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [account, setAccount] = useState<ResponseOf<typeof endpoints.me> | null>(null);
  const [accountVersion, setAccountVersion] = useState<number | null>(null);
  const [locale, setLocale] = useState("en");
  const [words, setWords] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void state.run(async () => {
      const response = await props.client.callWithMetadata(endpoints.me, { params: {}, query: {}, body: undefined }, abort.signal);
      const value = editorValue(response.result);
      if (!abort.signal.aborted) {
        setAccount(value); setAccountVersion(response.metadata.expectedVersion); setLocale(value.user.interfaceLanguage);
        setPreferences(value.preferences); setWords(value.preferences.customWords.join("\n"));
      }
    });
    return () => abort.abort();
  }, [props.client, state.run]);
  return <section aria-label="Interface preferences">
    <h2>Interface preferences</h2>
    {!account && !state.error && <p role="status">Loading account preferences.</p>}
    {account && <form className="editor-tools__stack" onSubmit={event => {
      event.preventDefault();
      void state.run(async () => {
        if (accountVersion === null) throw new TypeError("Account version is missing. Reopen preferences before saving.");
        const response = await props.client.callWithMetadata(endpoints.profilePatch, { params: {}, query: {},
          body: { interfaceLanguage: UserSchema.unwrap().shape.interfaceLanguage.parse(locale), expectedVersion: accountVersion } });
        editorValue(response.result);
        setAccountVersion(response.metadata.expectedVersion);
        await props.onSessionChange?.();
        document.documentElement.lang = locale;
        state.setMessage(props.onSessionChange ? "Interface language saved." : "Interface language saved. Reload to apply the complete interface catalog.");
      });
    }}>
      <label>Interface language<select aria-label="Interface language" value={locale} onChange={event => setLocale(event.target.value)}>
        <option value="en">English</option><option value="vi">Tiếng Việt</option><option value="zh">中文</option>
      </select></label>
      <Button type="submit" disabled={state.busy || accountVersion === null}>Save interface language</Button>
    </form>}
    {preferences && <form className="editor-tools__stack" onSubmit={event => {
      event.preventDefault();
      void state.run(async () => {
        const customWords = [...new Set(words.split(/\r?\n/).map(word => word.trim()).filter(Boolean))];
        const saved = editorValue(await props.client.call(endpoints.preferencesPatch, { params: {}, query: {}, body: {
          theme: preferences.theme, dictionary: preferences.dictionary, spellCheck: preferences.spellCheck,
          customWords, expectedVersion: preferences.version,
        } }));
        setPreferences(saved);
        props.onPreferencesChange?.(saved);
        document.documentElement.dataset["theme"] = saved.theme;
        state.setMessage(props.onPreferencesChange ? "Editor preferences saved." : "Editor preferences saved. Reopen the document to apply them.");
      });
    }}>
      <label>Theme<select aria-label="Theme" value={preferences.theme} onChange={event => setPreferences({
        ...preferences, theme: PreferencesSchema.unwrap().shape.theme.parse(event.target.value),
      })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label>Spelling dictionary<select aria-label="Spelling dictionary" value={preferences.dictionary} onChange={event => setPreferences({
        ...preferences, dictionary: PreferencesSchema.unwrap().shape.dictionary.parse(event.target.value),
      })}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="vi">Vietnamese</option><option value="zh">Chinese</option></select></label>
      <label><input type="checkbox" checked={preferences.spellCheck} onChange={event => setPreferences({
        ...preferences, spellCheck: event.target.checked,
      })} /> Check spelling</label>
      <label>Custom dictionary words (one per line)<textarea aria-label="Custom dictionary words" value={words} onChange={event => setWords(event.target.value)} /></label>
      <Button type="submit" variant="primary" disabled={state.busy}>Save editor preferences</Button>
    </form>}
    <Feedback state={state} />
  </section>;
}
