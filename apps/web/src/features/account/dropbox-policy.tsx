import { useCallback, useEffect, useId, useState } from "react";
import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import type { AdapterGrant, Id, Operation, ResponseOf } from "@quire/contracts";
import { Button } from "../../ui";
import { mutationHeaders, Notice, Panel, readInput, unwrap, useAction } from "./shared";
import type { SettingsProps } from "./settings";
import { currentConnections } from "./connections";
import { DropboxFolderProjects } from "./dropbox-folder-project";

type ScopeChoice = {
  readonly id: Id; readonly kind: "project" | "organization"; readonly name: string;
};
type Policy = ResponseOf<typeof endpoints.dropboxPolicyGet>;
const syncResult = z.object({
  cursor: z.string().nullable(), generatedOutput: z.boolean(), recovered: z.boolean(),
  conflicts: z.array(z.object({ kind: z.string(), path: z.string(), remotePath: z.string().nullable(), copyPath: z.string().nullable() })),
});
const disconnectResult = z.object({ disconnected: z.literal(true) });

export function DropboxSettings(props: SettingsProps) {
  const scopeId = useId();
  const [scopes, setScopes] = useState<readonly ScopeChoice[] | null>(null);
  const [selected, setSelected] = useState("");
  const [grants, setGrants] = useState<readonly AdapterGrant[]>([]);
  const [error, setError] = useState("");
  const action = useAction();
  const selectionKey = `quire:dropbox:scope:${props.account.user.id}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const choices: ScopeChoice[] = [];
    let cursor: string | null = null;
    do {
      const page: ResponseOf<typeof endpoints.projectList> = unwrap(await props.client.call(endpoints.projectList, { params: {}, query: {
        owner: "me", state: "active", sort: "title", direction: "asc", limit: 200, ...(cursor ? { cursor } : {}),
      }, body: undefined }, signal));
      choices.push(...page.items.filter(project => project.ownerId === props.account.user.id)
        .map(project => ({ id: project.id, kind: "project" as const, name: project.name })));
      cursor = page.nextCursor;
    } while (cursor !== null);
    do {
      const page: ResponseOf<typeof endpoints.organizationsList> = unwrap(await props.client.call(endpoints.organizationsList, {
        params: {}, query: { limit: 200, ...(cursor ? { cursor } : {}) }, body: undefined,
      }, signal));
      choices.push(...page.items.map(organization => ({ id: organization.id, kind: "organization" as const, name: organization.name })));
      cursor = page.nextCursor;
    } while (cursor !== null);
    setGrants((await currentConnections(props.client, signal)).filter(grant => grant.provider === "dropbox" && grant.state === "ready"));
    setScopes(choices); setError("");
    setSelected(previous => {
      const saved = previous || localStorage.getItem(selectionKey);
      return choices.some(scope => `${scope.kind}:${scope.id}` === saved) ? saved ?? "" : "";
    });
  }, [props.client, props.account.user.id, selectionKey]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof Error) setError(cause.message); else throw cause;
    });
    return () => controller.abort();
  }, [load]);
  const scope = scopes?.find(choice => `${choice.kind}:${choice.id}` === selected);
  return <Panel title="Dropbox policy & sync">
    <div className="account-form dropbox-settings">
      <p className="account-muted">Project owners and organization administrators control Dropbox access. Organization denial always overrides project permission.</p>
      <Button disabled={action.busy} onClick={() => { void action.run(() => load()); }}>Reload Dropbox settings</Button>
      <Notice error={error} message="" />
      <DropboxFolderProjects client={props.client} grants={grants} />
      {!scopes && !error && <p role="status">Loading accessible scopes...</p>}
      {scopes?.length === 0 && <p>No owned projects or accessible organizations. Create a project to manage its Dropbox policy.</p>}
      {scopes && scopes.length > 0 && <div className="q-field"><label className="q-field__label" htmlFor={scopeId}>Dropbox policy scope</label>
        <select id={scopeId} className="q-input" value={selected} onChange={event => {
          setSelected(event.target.value); localStorage.setItem(selectionKey, event.target.value);
        }}><option value="">Select a project or organization</option>{scopes.map(choice => <option key={`${choice.kind}:${choice.id}`} value={`${choice.kind}:${choice.id}`}>{choice.kind === "project" ? "Project" : "Organization"}: {choice.name}</option>)}</select>
      </div>}
      {scope && <DropboxPolicy key={selected} client={props.client} scope={scope} grants={grants} />}
      <Notice {...action} />
    </div>
  </Panel>;
}

function DropboxPolicy({ client, scope, grants }: {
  readonly client: SettingsProps["client"]; readonly scope: ScopeChoice; readonly grants: readonly AdapterGrant[];
}) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const action = useAction();
  const params = { scopeKind: scope.kind, id: scope.id };
  async function load(signal?: AbortSignal) {
    const current = unwrap(await client.call(endpoints.dropboxPolicyGet, { params, query: {}, body: undefined }, signal));
    setPolicy(current); setEnabled(current.enabled); setError("");
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof Error) setError(cause.message); else throw cause;
    });
    return () => controller.abort();
  }, [client, scope.id, scope.kind]);
  return <div className="account-form">
    <h3>{scope.name}</h3>
    <Notice error={error} message="" />
    {!policy && !error && <p role="status">Loading current policy...</p>}
    <Button disabled={action.busy} onClick={() => { void action.run(() => load()); }}>Reload policy</Button>
    {policy && <form className="account-form" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const saved = unwrap(await client.call(endpoints.dropboxPolicyPut, { params, query: {}, body: { enabled, expectedVersion: policy.version } }));
        setPolicy(saved); setEnabled(saved.enabled); action.setMessage("Dropbox policy saved.");
      });
    }}>
      <label className="account-check"><span>Allow Dropbox for this {scope.kind}</span><input type="checkbox" checked={enabled} disabled={action.busy} onChange={event => setEnabled(event.target.checked)} /></label>
      <p role="status">Effective access: {policy.effectiveEnabled ? "Allowed" : "Denied"} · Policy version {policy.version}</p>
      {policy.enabled && !policy.effectiveEnabled && <p className="account-muted">Project permission is enabled, but an organization policy denies Dropbox. Enabling this project cannot override that denial.</p>}
      <Button type="submit" disabled={action.busy || enabled === policy.enabled}>Save Dropbox policy</Button>
    </form>}
    <Notice {...action} />
    {scope.kind === "project" && policy && <DropboxProjectSync client={client} scope={scope} grants={grants} allowed={policy.effectiveEnabled} />}
  </div>;
}

function DropboxProjectSync({ client, scope, grants, allowed }: {
  readonly client: SettingsProps["client"]; readonly scope: ScopeChoice;
  readonly grants: readonly AdapterGrant[]; readonly allowed: boolean;
}) {
  const connectionId = useId();
  const [selected, setSelected] = useState(grants[0]?.id ?? "");
  const [generated, setGenerated] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const action = useAction();
  const storageKey = `quire:dropbox:operation:${scope.id}`;
  useEffect(() => {
    const id = IdSchema.safeParse(localStorage.getItem(storageKey));
    if (!id.success) return undefined;
    const controller = new AbortController();
    void client.call(endpoints.operationGet, { params: { id: id.data }, query: {}, body: undefined }, controller.signal)
      .then(result => setOperation(unwrap(result))).catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof Error) action.setError(cause.message); else throw cause;
      });
    return () => controller.abort();
  }, [client, storageKey]);
  const grant = grants.find(entry => entry.id === selected);
  const completed = operation?.status === "succeeded" ? syncResult.safeParse(operation.result) : null;
  const disconnected = operation?.status === "succeeded" ? disconnectResult.safeParse(operation.result) : null;
  return <div className="account-form">
    <h3>Project synchronization</h3>
    {grants.length === 0 ? <p>No active Dropbox connection. Connect Dropbox above, then reload Dropbox settings.</p> : <>
      <div className="q-field"><label className="q-field__label" htmlFor={connectionId}>Dropbox connection</label><select id={connectionId} className="q-input" value={selected} disabled={action.busy} onChange={event => setSelected(event.target.value)}><option value="">Select a connection</option>{grants.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></div>
      <label className="account-check"><span>Include generated output in outbound sync</span><input type="checkbox" checked={generated} disabled={action.busy} onChange={event => setGenerated(event.target.checked)} /></label>
      <div className="account-row">{[
        ["initialSync", "Start project sync"], ["sync", "Sync project now"], ["disconnect", "Disconnect project sync"],
      ].map(([name, label]) => <Button key={name} disabled={action.busy || !grant || (!allowed && name !== "disconnect")} onClick={() => { void action.run(async () => {
        if (!grant || !name) return;
        const current = unwrap(await client.call(endpoints.connectionCursor, { params: { id: grant.id }, query: { action: name, projectId: scope.id }, body: undefined }));
        const response = await client.call(endpoints.connectionAction, { params: { id: grant.id }, query: {}, body: {
          action: name, projectId: scope.id, expectedVersion: current.grantVersion, expectedCursor: current.cursor,
          parameters: name === "disconnect" ? {} : { generatedOutput: generated },
        }, headers: mutationHeaders() });
        if ("error" in response && ["CURSOR_CONFLICT", "VERSION_CONFLICT"].includes(response.error.code)) {
          const refreshed = unwrap(await client.call(endpoints.connectionCursor, { params: { id: grant.id }, query: { action: name, projectId: scope.id }, body: undefined }));
          action.setError(`${response.error.message}. Current connection state refreshed (version ${refreshed.grantVersion}). Retry the action explicitly.`);
          return;
        }
        const result = unwrap(response);
        localStorage.setItem(storageKey, result.id); setOperation(result);
      }); }}>{label}</Button>)}</div>
    </>}
    {operation && <section className="dropbox-result" aria-label="Dropbox operation">
      <h3>Latest operation</h3>
      <dl><dt>Operation</dt><dd>{operation.id}</dd><dt>Status</dt><dd>{operation.status}</dd></dl>
      {operation.errorCode && <p role="alert">{operation.errorCode}</p>}
      {completed?.success && <><p>Synchronization completed. {completed.data.conflicts.length} conflicts. Generated output {completed.data.generatedOutput ? "included" : "excluded"}.</p>
        {completed.data.recovered && <p>Recovered a previously prepared synchronization.</p>}
        {completed.data.conflicts.length > 0 && <ul>{completed.data.conflicts.map((conflict, index) => <li key={`${conflict.path}:${index}`}>{conflict.kind}: {conflict.path}{conflict.copyPath ? `; preserved copy: ${conflict.copyPath}` : ""}{conflict.remotePath ? `; remote: ${conflict.remotePath}` : ""}</li>)}</ul>}
      </>}
      {disconnected?.success && <p>Project synchronization disconnected. The account provider grant remains connected.</p>}
      <Button disabled={action.busy} onClick={() => { void action.run(async () => {
        setOperation(unwrap(await client.call(endpoints.operationGet, { params: { id: operation.id }, query: {}, body: readInput.body })));
      }); }}>Refresh operation status</Button>
    </section>}
    <Notice {...action} />
  </div>;
}
