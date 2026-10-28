import { assertNever, endpoints, ProjectPathSchema } from "@quire/contracts";
import type { FileEntry, Id, Publication } from "@quire/contracts";
import { EditorApiError, editorValue } from "../shared";
import type { ToolsPanelProps } from "../shared";

export function toolBlocked(props: ToolsPanelProps): string | null {
  const persistence = props.document?.getSnapshot().persistence;
  switch (persistence?.kind) {
    case "offline": return "Offline. Reconnect before using project tools.";
    case "recovery": return "Recover pending source changes before using project tools.";
    case "closed": return persistence.reason;
    case "connecting": return "Connecting to the document.";
    case "saved": case "saving": case undefined: return null;
    default: return assertNever(persistence);
  }
}

/** Structural writes use the branch revision after flushing, never a file revision. */
export function createToolsActions(props: ToolsPanelProps) {
  const { client, workspace } = props;
  const params = { p: workspace.scope.projectId };
  const query = { branch: workspace.scope.branch };
  const headers = workspace.requestHeaders;
  const keyed = () => ({ ...headers, "idempotency-key": crypto.randomUUID() });
  async function ready(write = false, signal?: AbortSignal) {
    const blocked = toolBlocked(props);
    if (blocked) throw new EditorApiError("TOOLS_BLOCKED", blocked);
    if (write && !workspace.access.capabilities.edit) {
      throw new EditorApiError("FORBIDDEN", "Your access does not allow project changes.");
    }
    await props.document?.flush(signal);
    const access = editorValue(await client.call(endpoints.projectAccess, { params, query, headers, body: undefined }, signal));
    if (write && !access.capabilities.edit) throw new EditorApiError("FORBIDDEN", "Project editing access changed.");
    return access.branchRevision;
  }
  return {
    ready,
    async create(input: { readonly path: string; readonly kind: "file" | "folder"; readonly text: string }) {
      const expectedVersion = await ready(true);
      const file = editorValue(await client.call(endpoints.fileCreate, {
        params, query: {}, headers: keyed(),
        body: { scope: workspace.scope, path: ProjectPathSchema.parse(input.path), kind: input.kind, text: input.text, expectedVersion },
      }));
      await props.refreshWorkspace();
      return file;
    },
    async rename(file: FileEntry, path: string) {
      const expectedVersion = await ready(true);
      const updated = editorValue(await client.call(endpoints.filePatch, {
        params: { ...params, f: file.id }, query: {}, headers,
        body: { scope: workspace.scope, path: ProjectPathSchema.parse(path), expectedVersion },
      }));
      await props.refreshWorkspace();
      return updated;
    },
    async remove(file: FileEntry) {
      const expectedVersion = await ready(true);
      editorValue(await client.call(endpoints.fileDelete, {
        params: { ...params, f: file.id }, query: {}, headers,
        body: { scope: workspace.scope, expectedVersion },
      }));
      await props.refreshWorkspace();
    },
    async upload(files: readonly File[], prefix = "") {
      const expectedVersion = await ready(true);
      const form = new FormData();
      const paths = files.map(file => ProjectPathSchema.parse(`${prefix}${file.webkitRelativePath || file.name}`));
      form.set("scope", JSON.stringify(workspace.scope));
      form.set("paths", JSON.stringify(paths));
      form.set("expectedVersion", String(expectedVersion));
      for (const file of files) form.append("files", file);
      const uploaded = editorValue(await client.call(endpoints.filesUpload, { params, query: {}, headers: keyed(), body: form }));
      await props.refreshWorkspace();
      return uploaded;
    },
    async download(file: FileEntry, signal?: AbortSignal) {
      await ready(false, signal);
      return editorValue(await client.call(endpoints.fileContent, {
        params: { ...params, f: file.id }, query, headers, body: undefined,
      }, signal));
    },
    async link(input: { readonly path: string; readonly kind: "url" | "project"; readonly url?: string; readonly sourceProjectId?: Id; readonly sourceFileId?: Id }) {
      const expectedVersion = await ready(true);
      const file = editorValue(await client.call(endpoints.linkCreate, {
        params, query: {}, headers: keyed(),
        body: { ...input, scope: workspace.scope, path: ProjectPathSchema.parse(input.path), expectedVersion },
      }));
      await props.refreshWorkspace();
      return file;
    },
    async refreshLink(file: FileEntry) {
      const expectedVersion = await ready(true);
      if (!file.link || !file.blob) throw new EditorApiError("NOT_LINKED", "Choose a linked file with preserved content.");
      const updated = editorValue(await client.call(endpoints.linkRefresh, {
        params: { ...params, id: file.id }, query: {}, headers: keyed(),
        body: { expectedVersion, expectedDigest: file.blob },
      }));
      await props.refreshWorkspace();
      return updated;
    },
    async search(input: { readonly q: string; readonly matchCase: boolean; readonly regex: boolean; readonly word: boolean }) {
      await ready();
      return editorValue(await client.call(endpoints.projectSearch, {
        params, query: { ...query, q: input.q, case: input.matchCase ? "true" : "false", regex: input.regex ? "true" : "false", word: input.word ? "true" : "false" },
        headers, body: undefined,
      }));
    },
    async citation(publication: Publication, targetFileId?: Id) {
      const expectedVersion = await ready(true);
      const file = editorValue(await client.call(endpoints.citationCreate, {
        params, query: {}, headers: keyed(), body: {
          scope: workspace.scope, publication, command: "cite", expectedVersion,
          ...(targetFileId ? { targetFileId } : {}),
        },
      }));
      await props.refreshWorkspace();
      return file;
    },
  };
}

export function saveDownload(file: Pick<FileEntry, "path" | "mime">, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: file.mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.path.split("/").at(-1) ?? file.path;
  anchor.click();
  // The browser has synchronously accepted the URL; revoke when this task completes.
  queueMicrotask(() => URL.revokeObjectURL(url));
}
