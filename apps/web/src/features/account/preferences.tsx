import { useState } from "react";
import { endpoints, PreferencesSchema } from "@quire/contracts";
import { Button, Field } from "../../ui";
import { Check, Notice, Panel, SaveBar, Select, unwrap, useAction, value } from "./shared";
import type { SettingsProps } from "./settings";

const fields = {
  editor: [
    ["theme", "Theme", [["light", "Light"], ["dark", "Dark"], ["system", "System"]]],
    ["bindings", "Keybindings", [["default", "Default"], ["vim", "Vim"], ["emacs", "Emacs"]]],
    ["fontFamily", "Font family", [["plex", "IBM Plex Mono"], ["system", "System monospace"], ["serif", "Serif"]]],
    ["lineHeight", "Line height", [["compact", "Compact"], ["normal", "Normal"], ["wide", "Wide"]]],
    ["defaultView", "Default view", [["source", "Source"], ["split", "Split"], ["visual", "Visual"], ["pdf", "PDF"]]],
    ["defaultEngine", "Default compiler", [["pdflatex", "pdfLaTeX"], ["latex", "LaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"]]],
    ["dictionary", "Dictionary", [["en-US", "English (US)"], ["en-GB", "English (UK)"], ["vi", "Vietnamese"], ["zh", "Chinese"]]],
    ["viewer", "PDF viewer", [["builtin", "Built-in"], ["browser", "Browser"]]],
  ],
  ai: [
    ["aiMode", "Agent edits", [["ask", "Read only"], ["agent", "Propose for review"]]],
    ["aiStyle", "Writing style", [["match", "Match my document"], ["academic", "Concise academic"], ["plain", "Plain English"]]],
  ],
  git: [],
} as const;
const checks = {
  editor: [["spellCheck", "Spell check"], ["autoCompile", "Compile on save"], ["autocomplete", "Autocomplete commands and references"], ["autoClose", "Auto-close brackets and environments"], ["cursors", "Show collaborators’ cursors"]],
  ai: [["inlineCompletion", "Inline completions"], ["errorAssist", "Offer Fix with AI on compile errors"], ["citationWebSearch", "Search the web for citations"], ["aiBranch", "Default future Agent approvals to a new branch"], ["shareAiChat", "Default future conversation choice to shared"]],
  git: [["compileBeforeCommit", "Compile before every commit"]],
} as const;
export type PreferenceTab = keyof typeof fields;
export function PreferenceForm(props: SettingsProps & { readonly tab: PreferenceTab }) {
  const { preferences } = props.account;
  const action = useAction();
  const [generation, setGeneration] = useState(0);
  const title = { editor: "Editor", ai: "AI assistant", git: "Git preferences" }[props.tab];
  return <Panel title={title}>
    {props.tab === "ai" && <p className="account-muted">{props.account.capabilities["ai"]?.reason ?? "Model invocation depends on the configured AI provider and project policy. Saving preferences does not enable a provider."}</p>}
    {props.tab === "ai" && <p className="account-muted">These are defaults, not permissions. Review and Accept still authorize Agent edits, with a per-run branch override. Create or Open selects a shared conversation; Send shares future messages only. Saving never shares earlier private chat.</p>}
    <form key={generation + ":" + preferences.version} className="account-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run(async () => {
        const next: Record<string, unknown> = { ...preferences };
        for (const [name] of fields[props.tab]) next[name] = value(form, name);
        for (const [name] of checks[props.tab]) next[name] = form.has(name);
        if (props.tab === "editor") { next["fontSize"] = Number(value(form, "fontSize")); next["customWords"] = value(form, "customWords").split("\n").map(word => word.trim()).filter(Boolean); }
        if (props.tab === "ai") { next["aiModel"] = value(form, "aiModel") || null; next["citationProviders"] = value(form, "citationProviders").split(",").map(provider => provider.trim()).filter(Boolean); }
        const parsed = PreferencesSchema.parse(next);
        const { version, ...writable } = parsed;
        const saved = unwrap(await props.client.call(endpoints.preferencesPatch, { params: {}, query: {}, body: { ...writable, expectedVersion: version } }));
        document.documentElement.dataset["theme"] = saved.theme;
        await props.refresh(); await props.onSessionChange(); action.setMessage("Preferences saved.");
      });
    }}>
      <fieldset disabled={action.busy}>
        <div className="account-fields">
          {fields[props.tab].map(([name, label, options]) => <Select key={name} label={label} name={name} options={options} defaultValue={preferences[name]} />)}
          {props.tab === "editor" && <Field label="Font size" name="fontSize" type="number" min={10} max={24} step={1} defaultValue={preferences.fontSize} required />}
          {props.tab === "ai" && <><Field label="Model" name="aiModel" defaultValue={preferences.aiModel ?? ""} hint="Leave blank to use the server default." />
            <Field label="Citation sources" name="citationProviders" defaultValue={preferences.citationProviders.join(", ")} hint="Comma-separated configured provider identifiers" /></>}
        </div>
        {props.tab === "editor" && <label className="q-field"><span className="q-field__label">Custom dictionary words (one per line)</span><textarea className="q-input" name="customWords" defaultValue={preferences.customWords.join("\n")} /></label>}
        {checks[props.tab].map(([name, label]) => <Check key={name} name={name} label={label} checked={preferences[name]} />)}
        <Notice {...action} />
        {action.error && <Button onClick={() => { void action.run(async () => { await props.refresh(); action.setMessage("Latest preferences loaded. Review your changes before saving again."); }); }}>Reload current preferences</Button>}
        <SaveBar busy={action.busy} cancel={() => setGeneration(generation + 1)} />
      </fieldset>
    </form>
  </Panel>;
}
