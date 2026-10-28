import { useState } from "react";
import type { ToolsPanelProps } from "../shared";
import { Button, Field } from "../../../ui";
import { Feedback } from "./Feedback";
import { insertCommand } from "./insertion";
import { symbols, symbolCategories } from "./symbols";
import { useTool } from "./use-tool";

export function SymbolsPanel(props: ToolsPanelProps) {
  const state = useTool(props);
  const [category, setCategory] = useState("Greek");
  const [query, setQuery] = useState("");
  return <section aria-label="Symbols">
    <h2>Symbols</h2>
    <Field label="Search symbols" value={query} placeholder="Command or glyph" onChange={event => setQuery(event.target.value)} />
    <div className="editor-tools__cluster" aria-label="Symbol categories">
      {symbolCategories.map(name => <Button key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</Button>)}
    </div>
    <p>Inserts LaTeX at the source cursor. Use within math delimiters. Package requirements are shown before insertion.</p>
    <div className="editor-tools__symbols">
      {symbols.filter(symbol => (query ? `${symbol.command} ${symbol.glyph}`.toLowerCase().includes(query.toLowerCase()) : symbol.category === category)).map(symbol =>
        <Button key={symbol.command} title={`${symbol.command}${symbol.packageName ? ` requires ${symbol.packageName}` : " (LaTeX core)"}`}
          aria-label={`Insert ${symbol.command}${symbol.packageName ? ` with ${symbol.packageName}` : ""}`}
          disabled={!state.canWrite || !props.authoring || props.document?.getSnapshot().readOnly}
          onClick={() => void state.run(async () => {
            await insertCommand(props, symbol);
            state.setMessage(`Inserted ${symbol.command}${symbol.packageName ? `; ${symbol.packageName} is loaded in the main document` : ""}.`);
          })}>
          <span className="editor-tools__glyph">{symbol.glyph}</span><code>{symbol.command}</code>
          {symbol.packageName && <small>Requires {symbol.packageName}</small>}
        </Button>)}
    </div>
    <Feedback state={state} />
  </section>;
}
