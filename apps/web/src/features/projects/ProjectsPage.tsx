import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { endpoints, IdSchema, resourceVersionTag } from "@quire/contracts";
import type { Id, Operation, ProjectSummary, Tag, TemplateVersion } from "@quire/contracts";
import { AppHeader, Button, EmptyState, Field, Icon, IconButton, Modal, Spinner } from "../../ui";
import { errorMessage, mutationHeaders, useResource, value } from "./api";
import type { ProjectsPageProps } from "./api";
import { NewProjectDialog } from "./NewProjectDialog";
import type { NewProjectMode } from "./NewProjectDialog";
import { TemplateBrowser } from "./Templates";
import { ProjectActions, TagDialog } from "./ProjectActions";
import { OperationStatus } from "./OperationStatus";
import { OnboardingImportDialog } from "../account/OnboardingImportDialog";
import "./projects.css";

const OwnerSchema = z.enum(["all", "me", "shared"]);
const StateSchema = z.enum(["active", "archived", "trash"]);
const SortSchema = z.enum(["updated", "title", "owner"]);
const DirectionSchema = z.enum(["asc", "desc"]);
const WorkspaceSchema = z.union([z.enum(["all", "personal"]), IdSchema]);
const lists = [
  { label: "All projects", owner: "all", state: "active" },
  { label: "Your projects", owner: "me", state: "active" },
  { label: "Shared with you", owner: "shared", state: "active" },
  { label: "Archived", owner: "all", state: "archived" },
  { label: "Trash", owner: "all", state: "trash" },
] as const;
export function ProjectsPage({ client, navigate, path, onSessionChange }: ProjectsPageProps) {
  const onboardingImport = new URL(path, window.location.origin).searchParams.get("onboarding") === "1"
    && new URL(path, window.location.origin).searchParams.get("new") === "import";
  const workspaceQuery = new URL(path, window.location.origin).searchParams.get("workspace") ?? "all";
  const parsedWorkspace = WorkspaceSchema.safeParse(workspaceQuery);
  const pathWorkspace = parsedWorkspace.success ? parsedWorkspace.data : "all";
  const [workspace, setWorkspace] = useState(pathWorkspace);
  const [owner, setOwner] = useState<z.infer<typeof OwnerSchema>>("all");
  const [state, setState] = useState<z.infer<typeof StateSchema>>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<z.infer<typeof SortSchema>>("updated");
  const [direction, setDirection] = useState<z.infer<typeof DirectionSchema>>("desc");
  const [tagId, setTagId] = useState<Id>();
  const [cursor, setCursor] = useState<string>();
  const [selected, setSelected] = useState<readonly Id[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [creation, setCreation] = useState<{ readonly mode: NewProjectMode; readonly template?: TemplateVersion }>();
  useEffect(() => {
    if (new URL(path, window.location.origin).searchParams.get("new") === "import") setCreation({ mode: "upload" });
  }, [path]);
  function closeCreation() {
    setCreation(undefined);
    const destination = new URL(path, window.location.origin);
    if (destination.searchParams.get("new") === "import") {
      destination.searchParams.delete("new");
      if (onboardingImport) destination.searchParams.delete("onboarding");
      navigate(`${destination.pathname}${destination.search}${destination.hash}`);
    }
  }
  const [actionProject, setActionProject] = useState<ProjectSummary>();
  const [tagEditor, setTagEditor] = useState<{ readonly tag?: Tag }>();
  const [bulkTag, setBulkTag] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<Operation>();
  const [downloadable, setDownloadable] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const account = useResource(useCallback(async (signal: AbortSignal) => value(await client.call(endpoints.me, {
    params: {}, query: {}, body: undefined,
  }, signal)).user, [client]));
  useEffect(() => {
    setWorkspace(pathWorkspace);
    setCursor(undefined);
    setSelected([]);
    setActionProject(undefined);
    setError("");
  }, [pathWorkspace]);
  const workspaces = useResource(useCallback(async (signal: AbortSignal) => {
    const items: z.infer<typeof endpoints.projectWorkspaces.output>["items"][number][] = [];
    let next: string | undefined;
    do {
      const page = value(await client.call(endpoints.projectWorkspaces, {
        params: {}, query: { limit: 100, ...(next ? { cursor: next } : {}) }, body: undefined, headers: {},
      }, signal));
      items.push(...page.items); next = page.nextCursor ?? undefined;
    } while (next);
    return items;
  }, [client]));
  const projects = useResource(useCallback(async (signal: AbortSignal) => value(await client.call(endpoints.projectList, {
    params: {}, query: { workspace, q: query, owner, state, sort, direction, limit: 50, ...(tagId ? { tag: tagId } : {}), ...(cursor ? { cursor } : {}) }, body: undefined, headers: {},
  }, signal)), [client, workspace, query, owner, state, sort, direction, tagId, cursor]));
  const tags = useResource(useCallback(async (signal: AbortSignal) => {
    const items: Tag[] = [];
    let next: string | undefined;
    do {
      const page = value(await client.call(endpoints.tagsList, { params: {}, query: { limit: 100, ...(next ? { cursor: next } : {}) }, body: undefined, headers: {} }, signal));
      items.push(...page.items); next = page.nextCursor ?? undefined;
    } while (next);
    return items;
  }, [client]));
  const rows = projects.data?.items ?? [];
  const shownRows = projects.loading || projects.error ? [] : rows;
  const title = lists.find(item => item.owner === owner && item.state === state)?.label ?? "Projects";
  const resetSelection = () => { setSelected([]); setCursor(undefined); };
  const reload = () => { setSelected([]); projects.reload(); };
  async function bulk(action: "archive" | "trash" | "restore" | "download") {
    setBusy(true); setError("");
    try {
      const result = value(await client.call(endpoints.projectBulk, {
        params: {}, query: {}, headers: mutationHeaders(),
        body: { action, items: rows.filter(row => selected.includes(row.id)).map(row => ({ id: row.id, expectedVersion: row.version })) },
      }));
      setOperation(result);
      setDownloadable(action === "download");
      if (result.status === "succeeded") reload();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function assignTag() {
    setBusy(true); setError("");
    const completed: string[] = [];
    try {
      const id = IdSchema.parse(bulkTag);
      for (const row of rows.filter(item => selected.includes(item.id))) {
        value(await client.call(endpoints.projectTags, {
          params: { p: row.id }, query: {}, body: { tagIds: [...new Set([...row.tagIds, id])], expectedVersion: row.version },
          headers: { "if-match": resourceVersionTag(row.version) },
        }));
        completed.push(row.name);
      }
      reload();
    } catch (cause) { setError(`${errorMessage(cause)}${completed.length ? ` Already tagged: ${completed.join(", ")}. Refresh before retrying.` : ""}`); projects.reload(); }
    finally { setBusy(false); }
  }
  const navigation = <nav className="p-nav" aria-label="Project lists">
    <Button variant="primary" onClick={() => { setCreation({ mode: "template" }); setDrawer(false); }}><Icon name="plus" />New project</Button>
    {lists.map(item => <Button key={item.label} variant="ghost" aria-current={owner === item.owner && state === item.state && !tagId ? "page" : undefined}
      onClick={() => { setOwner(item.owner); setState(item.state); setTagId(undefined); resetSelection(); setDrawer(false); }}>{item.label}</Button>)}
    <div className="p-heading"><h2>Tags</h2><IconButton label="New tag" icon="plus" onClick={() => { setDrawer(false); setTagEditor({}); }} /></div>
    {tags.loading && <Spinner label="Loading tags" />}
    {tags.error && <p role="alert">{tags.error}<Button onClick={tags.reload}>Retry tags</Button></p>}
    {tags.data?.map(tag => <div className="p-tag-row" key={tag.id}><Button variant="ghost" aria-pressed={tagId === tag.id} onClick={() => { setTagId(tag.id); resetSelection(); setDrawer(false); }}><span className="p-dot" style={{ backgroundColor: tag.colorHex }} />{tag.name}</Button><IconButton label={`Edit tag ${tag.name}`} icon="settings" onClick={() => { setDrawer(false); setTagEditor({ tag }); }} /></div>)}
    {tagId && <Button onClick={() => { setTagId(undefined); resetSelection(); }}>Clear tag filter</Button>}
    <Button variant="ghost" onClick={() => navigate("/settings/profile")}>Account settings</Button>
  </nav>;
  return <div className="p-projects" data-path={path}>
    <AppHeader actions={<Button aria-label="Account settings" title={account.data?.name}
      onClick={() => navigate("/settings/profile")}>
      {account.data && (account.data.avatarBlob && !avatarError
        ? <img className="p-account-avatar" width={32} height={32} alt="" src={client.url(endpoints.avatarGet, {
          params: {}, query: {}, body: undefined,
        }).href} onError={() => setAvatarError("The saved profile photo could not be loaded.")} />
        : <span className="p-account-avatar" aria-hidden="true">{account.data.name.trim().split(/\s+/u)
          .slice(0, 2).map(part => Array.from(part)[0] ?? "").join("").toLocaleUpperCase()}</span>)}
      Account settings</Button>}>
      <Field label="Search projects and templates" placeholder="Search projects and templates" type="search" value={query} onChange={event => { setQuery(event.target.value); resetSelection(); }} />
      <label className="p-field p-workspace">Workspace<select aria-label="Workspace" value={workspace} disabled={busy} onChange={event => {
        const destination = new URL(path, window.location.origin);
        if (event.target.value === "all") destination.searchParams.delete("workspace");
        else destination.searchParams.set("workspace", event.target.value);
        resetSelection();
        navigate(`${destination.pathname}${destination.search}${destination.hash}`);
      }}>
        <option value="all">All workspaces</option>
        <option value="personal">Personal projects (no workspace)</option>
        {workspaces.data?.map(item => <option key={item.id} value={item.id}>{item.name} ({item.kind === "institution" ? "institution" : "team"})</option>)}
        {workspace !== "all" && workspace !== "personal" && !workspaces.data?.some(item => item.id === workspace)
          && <option value={workspace}>Unavailable workspace</option>}
      </select></label>
    </AppHeader>
    {account.error && <p role="alert">{account.error} <Button onClick={account.reload}>Retry account</Button></p>}
    {avatarError && <p role="status">{avatarError}</p>}
    <div className="p-shell"><aside className="p-sidebar">{navigation}</aside><main className="p-main">
      <div className="p-heading"><IconButton className="p-drawer-trigger" label="Project filters" icon="menu" onClick={() => setDrawer(true)} /><h1>{title}</h1><Button className="p-mobile-new" variant="primary" onClick={() => setCreation({ mode: "template" })}>New project</Button><div className="p-cluster">
        {([{ mode: "blank", label: "Blank project" }, { mode: "github", label: "Import from GitHub" }, { mode: "git", label: "Clone git URL" }, { mode: "upload", label: "Upload .zip" }] as const).map(item => <Button key={item.mode} onClick={() => setCreation({ mode: item.mode })}>{item.label}</Button>)}
      </div></div>
      <div className="p-cluster">
        <label className="p-field p-inline">Owner<select aria-label="Owner" value={owner} onChange={event => { setOwner(OwnerSchema.parse(event.target.value)); resetSelection(); }}><option value="all">All</option><option value="me">You</option><option value="shared">Shared with you</option></select></label>
        <label className="p-field p-inline">Sort by<select aria-label="Sort by" value={sort} onChange={event => { setSort(SortSchema.parse(event.target.value)); resetSelection(); }}><option value="updated">Last edited</option><option value="title">Title</option><option value="owner">Owner</option></select></label>
        <label className="p-field p-inline">Direction<select aria-label="Direction" value={direction} onChange={event => { setDirection(DirectionSchema.parse(event.target.value)); resetSelection(); }}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
        <Button onClick={reload}>Refresh projects</Button>
      </div>
      {selected.length > 0 && <div className="p-bulk" aria-label="Selected projects"><strong>{selected.length} selected</strong>
        {state === "active" && <Button disabled={busy} onClick={() => void bulk("archive")}>Archive</Button>}
        {state !== "trash" && <Button disabled={busy} onClick={() => void bulk("trash")}>Move to trash</Button>}
        {state !== "active" && <Button disabled={busy} onClick={() => void bulk("restore")}>Restore</Button>}
        <Button disabled={busy} onClick={() => void bulk("download")}>Download source</Button>
        <label className="p-field p-inline">Tag<select aria-label="Tag" value={bulkTag} onChange={event => setBulkTag(event.target.value)}><option value="">Choose tag</option>{tags.data?.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
        <Button disabled={busy || !bulkTag} onClick={() => void assignTag()}>Add tag to selected</Button>
        <Button onClick={() => setSelected([])}>Clear selection</Button>
      </div>}
      {error && <p role="alert">{error}</p>}
      {workspaces.loading && <Spinner label="Loading workspaces" />}
      {workspaces.error && <p role="alert">{workspaces.error}<Button onClick={workspaces.reload}>Retry workspaces</Button></p>}
      {projects.loading && <Spinner label="Loading projects" />}
      {projects.error && <div role="alert">{projects.error}<Button onClick={projects.reload}>Retry projects</Button></div>}
      {!projects.loading && !projects.error && rows.length === 0 && <EmptyState title="No projects found" description="Change the filters or create a project." action={<Button onClick={() => setCreation({ mode: "blank" })}>Blank project</Button>} />}
      {shownRows.length > 0 && <div className="p-table-wrap"><table className="p-table"><thead><tr><th><label className="p-select"><input type="checkbox" aria-label="Select all projects on this page" checked={shownRows.every(row => selected.includes(row.id))} onChange={event => setSelected(event.target.checked ? shownRows.map(row => row.id) : [])} /></label></th><th>Title</th><th>Owner</th><th>Last edited</th><th>Git</th><th>Compiler</th><th>Actions</th></tr></thead><tbody>
        {shownRows.map(row => <tr key={row.id}><td><label className="p-select"><input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.includes(row.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, row.id] : previous.filter(id => id !== row.id))} /></label></td>
          <td data-label="Title"><Button variant="ghost" className="p-project-title" onClick={() => navigate(`/projects/${row.id}/edit`)}>{row.name}</Button><span className="p-cluster">{row.tagIds.map(id => tags.data?.find(tag => tag.id === id)).filter(tag => tag !== undefined).map(tag => <span className="p-tag" key={tag.id}>{tag.name}</span>)}</span></td>
          <td data-label="Owner">{row.ownerName}</td><td data-label="Last edited"><time dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleString()}</time></td><td data-label="Git"><code>{row.defaultBranch}</code></td><td data-label="Compiler">{row.settings.engine}</td><td><Button aria-label={`Project actions for ${row.name}`} onClick={() => setActionProject(row)}>Project actions</Button></td>
        </tr>)}
      </tbody></table></div>}
      {projects.data?.nextCursor && !projects.loading && !projects.error && <Button onClick={() => { setCursor(projects.data?.nextCursor ?? undefined); setSelected([]); }}>Next page</Button>}
      {cursor && <Button onClick={() => { setCursor(undefined); setSelected([]); }}>First page</Button>}
      {operation && <OperationStatus key={operation.id} operation={operation} client={client} navigate={navigate} downloadable={downloadable} onComplete={reload} />}
      <TemplateBrowser client={client} externalQuery={query} onChoose={template => setCreation({ mode: "template", template })} />
    </main></div>
    {drawer && <Modal open title="Project filters" onClose={() => setDrawer(false)}>{navigation}</Modal>}
    {creation && (onboardingImport ? <OnboardingImportDialog client={client} navigate={navigate} path={path} onSessionChange={onSessionChange}
      onClose={closeCreation} onCreated={project => { setCreation(undefined); reload(); navigate(`/projects/${project.id}/edit`); }} />
      : <NewProjectDialog open client={client} navigate={navigate} initialMode={creation.mode} {...(creation.template ? { initialTemplate: creation.template } : {})} onClose={closeCreation} onCreated={project => { setCreation(undefined); reload(); navigate(`/projects/${project.id}/edit`); }} />)}
    {actionProject && <ProjectActions project={actionProject} tags={tags.data ?? []} client={client} navigate={navigate} onClose={() => setActionProject(undefined)} onChanged={reload} />}
    {tagEditor && <TagDialog client={client} {...(tagEditor.tag ? { tag: tagEditor.tag } : {})} onClose={() => setTagEditor(undefined)} onChanged={tags.reload} />}
  </div>;
}
