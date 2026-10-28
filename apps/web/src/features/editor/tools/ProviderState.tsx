import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Capability, AdapterGrant } from "@quire/contracts";
import { editorValue } from "../shared";
import type { ToolsPanelProps } from "../shared";
import { Button } from "../../../ui";
import { Feedback } from "./Feedback";
import { useTool } from "./use-tool";

export function ProviderState(props: ToolsPanelProps) {
  const state = useTool(props);
  const [capabilities, setCapabilities] = useState<Readonly<Record<string, Capability>> | null>(null);
  const [connections, setConnections] = useState<readonly AdapterGrant[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void state.run(async () => {
      const [me, grants] = await Promise.all([
        props.client.call(endpoints.me, { params: {}, query: {}, body: undefined }, abort.signal),
        props.client.call(endpoints.connectionsList, { params: {}, query: {}, body: undefined }, abort.signal),
      ]);
      const account = editorValue(me);
      if (!abort.signal.aborted) setCapabilities(account.capabilities);
      const page = editorValue(grants);
      if (!abort.signal.aborted) { setConnections(page.items); setCursor(page.nextCursor); }
    });
    return () => abort.abort();
  }, [props.client, state.run]);
  return <section aria-label="Provider configuration">
    <h2>Provider configuration</h2>
    <p>Connection state is reported by this server. Reference retrieval and AI execution belong to their configured adapters.</p>
    <dl>{Object.entries(capabilities ?? {}).filter(([name]) => /reference|zotero|mendeley|readcube|crossref|arxiv|semantic|dimension|doi|ai/i.test(name)).map(([name, capability]) =>
      <div key={name}><dt>{name}</dt><dd>{capability.state}{capability.reason ? `: ${capability.reason}` : ""}</dd></div>)}</dl>
    <ul>{connections.map(connection => <li key={connection.id}>{connection.provider}: {connection.label} ({connection.state})</li>)}</ul>
    {capabilities && connections.length === 0 && <p>No personal provider connections.</p>}
    {cursor && <Button disabled={state.busy} onClick={() => void state.run(async () => {
      const page = editorValue(await props.client.call(endpoints.connectionsList, { params: {}, query: { cursor }, body: undefined }));
      setConnections(previous => [...previous, ...page.items]); setCursor(page.nextCursor);
    })}>Load more connections</Button>}
    <Feedback state={state} />
  </section>;
}
