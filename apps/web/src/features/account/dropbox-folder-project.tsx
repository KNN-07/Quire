import { useId, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { AdapterGrant, Operation } from "@quire/contracts";
import { DropboxFolderImportSchema, DropboxFolderInspectionSchema, DropboxFoldersResultSchema } from "../../../../../packages/contracts/src/routes-adapters";
import { Button } from "../../ui";
import { mutationHeaders, Notice, unwrap, useAction } from "./shared";
import type { SettingsProps } from "./settings";

type Folders = ReturnType<typeof DropboxFoldersResultSchema.parse>["folders"];
type Inspection = ReturnType<typeof DropboxFolderInspectionSchema.parse>;

export function DropboxFolderProjects({ client, grants }: {
  readonly client: SettingsProps["client"]; readonly grants: readonly AdapterGrant[];
}) {
  const connectionId = useId(), folderId = useId(), nameId = useId(), mainId = useId();
  const [connection, setConnection] = useState("");
  const [folders, setFolders] = useState<Folders | null>(null);
  const [selected, setSelected] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [name, setName] = useState("");
  const [mainPath, setMainPath] = useState("");
  const [needsReauthorization, setNeedsReauthorization] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const action = useAction();
  const grant = grants.find(item => item.id === connection) ?? (connection === "" ? grants[0] : undefined);
  const imported = operation?.status === "succeeded" ? DropboxFolderImportSchema.safeParse(operation.result) : null;
  const folder = folders?.find(item => item.id === selected);
  async function execute(kind: "discoverFolders" | "inspectFolder" | "importFolder" | "reauthorizeFolderImport",
    parameters: Record<string, string | boolean>) {
    if (!grant) throw new Error("Select an active Dropbox connection");
    const cursor = unwrap(await client.call(endpoints.connectionCursor, {
      params: { id: grant.id }, query: { action: kind }, body: undefined,
    }));
    const response = await client.call(endpoints.connectionAction, {
      params: { id: grant.id }, query: {}, headers: mutationHeaders(),
      body: { action: kind, parameters, expectedVersion: cursor.grantVersion, expectedCursor: cursor.cursor },
    });
    if ("error" in response && response.error.code === "DROPBOX_AUTHORITY_CHANGED") {
      setNeedsReauthorization(true); setConfirmed(false);
    }
    const result = unwrap(response);
    if (result.status !== "succeeded") throw new Error(`Dropbox operation ${result.id}: ${result.errorCode ?? result.status}`);
    return result;
  }
  return <section className="account-form" aria-label="Create project from Dropbox folder">
    <h3>Create project from a Dropbox folder</h3>
    <p className="account-muted">Discover folders directly inside Apps/Quire, select a TeX main file, then explicitly import. Your files stay in their original Dropbox folder, which remains connected for two-way sync. Generated output is excluded.</p>
    {grants.length === 0 ? <p>Connect Dropbox above, then reload Dropbox settings to discover folders.</p> : <>
      <div className="q-field"><label className="q-field__label" htmlFor={connectionId}>Folder import connection</label>
        <select id={connectionId} className="q-input" value={grant?.id ?? ""} disabled={action.busy} onChange={event => {
          setConnection(event.target.value); setFolders(null); setSelected(""); setInspection(null); setOperation(null);
          setNeedsReauthorization(false); setConfirmed(false);
        }}>{grants.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
      <Button disabled={action.busy || !grant} onClick={() => { void action.run(async () => {
        const result = await execute("discoverFolders", {});
        setFolders(DropboxFoldersResultSchema.parse(result.result).folders);
        setSelected(""); setInspection(null); setOperation(null);
        setNeedsReauthorization(false); setConfirmed(false);
      }); }}>Discover Dropbox folders</Button>
      {folders?.length === 0 && <p>No project folders found directly inside Apps/Quire. Add a folder containing a TeX project in Dropbox, then discover again.</p>}
      {folders && folders.length > 0 && <div className="q-field"><label className="q-field__label" htmlFor={folderId}>Dropbox project folder</label>
        <select id={folderId} className="q-input" value={selected} disabled={action.busy} onChange={event => {
          setSelected(event.target.value); setInspection(null); setOperation(null);
          setNeedsReauthorization(false); setConfirmed(false);
        }}><option value="">Select a folder</option>{folders.map(item => <option key={item.id} value={item.id}>{item.path}{item.projectId ? " (already imported)" : ""}</option>)}</select></div>}
      {folder?.projectId ? <a className="q-button" href={`/projects/${folder.projectId}/edit`}>Open imported project</a> : folder && <>
        <Button disabled={action.busy} onClick={() => { void action.run(async () => {
          const result = await execute("inspectFolder", { folderId: folder.id });
          const value = DropboxFolderInspectionSchema.parse(result.result);
          setInspection(value); setName(value.pendingImport?.name ?? value.folder.path.slice(1));
          setMainPath(value.pendingImport?.mainPath ?? value.mainPaths[0] ?? "");
          setNeedsReauthorization(value.pendingImport?.requiresReauthorization ?? false); setConfirmed(false);
        }); }}>Inspect selected folder</Button>
        {inspection && <form className="account-form" onSubmit={event => {
          event.preventDefault();
          void action.run(async () => {
            if (needsReauthorization && !confirmed) throw new Error("Confirm resuming the previously prepared snapshot.");
            const result = await execute(needsReauthorization ? "reauthorizeFolderImport" : "importFolder", {
              folderId: inspection.folder.id, name, mainPath, ...(needsReauthorization ? { confirmation: true } : {}),
            });
            DropboxFolderImportSchema.parse(result.result);
            setOperation(result); action.setMessage("Project imported and connected to its original Dropbox folder.");
          });
        }}>
          <p>{inspection.fileCount} source files, {inspection.bytes.toLocaleString()} bytes. Binary files and nested paths are preserved.</p>
          <div className="q-field"><label className="q-field__label" htmlFor={nameId}>Imported project name</label>
            <input id={nameId} className="q-input" value={name} required maxLength={255} disabled={action.busy || imported?.success || needsReauthorization}
              onChange={event => setName(event.target.value)} /></div>
          <div className="q-field"><label className="q-field__label" htmlFor={mainId}>Dropbox main file</label>
            <select id={mainId} className="q-input" value={mainPath} disabled={action.busy || imported?.success || needsReauthorization}
              onChange={event => setMainPath(event.target.value)}>{inspection.mainPaths.map(path => <option key={path} value={path}>{path}</option>)}</select></div>
          {needsReauthorization && <>
            <p>Connection authority changed after preparation. Resume the previously prepared source snapshot
              {inspection.pendingImport ? ` from ${inspection.pendingImport.preparedAt}` : ""}, not newer Dropbox contents.
              Sync the project afterward to reconcile later changes. Current access and policy will be checked again.</p>
            <label className="account-check"><span>Authorize the prepared import with current access</span>
              <input type="checkbox" checked={confirmed} disabled={action.busy || imported?.success}
                onChange={event => setConfirmed(event.target.checked)} /></label>
          </>}
          <Button type="submit" disabled={action.busy || !name.trim() || !mainPath || imported?.success || (needsReauthorization && !confirmed)}>
            {needsReauthorization ? "Resume prepared import" : "Import folder as project"}
          </Button>
        </form>}
      </>}
      {imported?.success && <section aria-label="Imported Dropbox project">
        <p>Connected folder: {imported.data.path}</p>
        <p>Operation: {operation?.id}</p>
        <a className="q-button" href={`/projects/${imported.data.projectId}/edit`}>Open imported project</a>
      </section>}
    </>}
    <Notice {...action} />
  </section>;
}
