import { z } from "zod";
import { IdSchema, ProjectPathSchema, ProjectSchema, GitOidSchema } from "@quire/contracts";
import type { Id, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects, sourceIntent } from "../../core/base";
import { decodeText, limits } from "../../core/base/limits";
import type { NativeFile } from "../../core/base/projects";
import type { ActionContext, AdapterDefinition, AdapterServices, PreparedAction } from "../shared";
import { DropboxApi } from "./api";
import type { DropboxEndpoints } from "./api";
import { DropboxPolicies } from "./policy";
import { DropboxStore } from "./journal";
import { folderImport, folderReservation as reservation, generatedPath, remoteFile, remoteFolder, syncState } from "./model";
import type { FolderImport as Selection, RemoteFile } from "./model";
const preparedImport = z.object({
  actorId: IdSchema, grantVersion: z.number(), configVersion: z.number(), key: z.string(),
  project: ProjectSchema, source: sourceIntent, folder: remoteFolder, state: syncState,
});

export class DropboxFolders {
  readonly policies: DropboxPolicies;
  constructor(readonly services: AdapterServices, readonly endpoints: DropboxEndpoints) {
    this.policies = new DropboxPolicies(services.context);
  }
  async discover(context: ActionContext): Promise<PreparedAction> {
    await this.policies.assertImport(context.actorId);
    const api = new DropboxApi(this.services.http, this.endpoints, context);
    const listing = await api.entries("", false, 2000);
    const folders = [];
    for (const entry of listing.entries) {
      if (entry[".tag"] !== "folder") continue;
      const folder = remoteFolder.parse(entry);
      // Only direct app-folder children are offered; nested content belongs to its selected project.
      if (folder.path_lower.split("/").length !== 2) continue;
      ProjectPathSchema.parse(folder.path_display.slice(1));
      const binding = await this.binding(context, folder.id, folder.path_display);
      folders.push({ id: folder.id, path: folder.path_display, projectId: binding?.project_id ?? null });
    }
    return { result: { folders }, cursor: null, publish: tx => this.policies.assertImport(context.actorId, tx) };
  }
  private async binding(context: ActionContext, folderId: string, path?: string) {
    let row = await this.services.context.db.get<{ project_id: Id; path: string }>(
      "SELECT project_id,path FROM dropbox_folder_bindings WHERE grant_id=? AND folder_id=?", [context.grant.id, folderId]);
    if (!row && path) {
      const projectId = IdSchema.safeParse(path.slice(1));
      if (projectId.success && await this.services.context.db.get(
        "SELECT 1 FROM dropbox_sync WHERE grant_id=? AND project_id=?", [context.grant.id, projectId.data])) {
        row = { project_id: projectId.data, path };
      }
    }
    if (row) {
      const projects = new CoreProjects(this.services.context);
      const project = await projects.getProject(row.project_id);
      await projects.authorize(context.actorId, { projectId: project.id, branch: project.defaultBranch }, "owner");
      await this.policies.assert(context.actorId, project.id);
    }
    return row;
  }
  private async readFolder(context: ActionContext, folderId: string) {
    await this.policies.assertImport(context.actorId);
    const api = new DropboxApi(this.services.http, this.endpoints, context);
    const folder = await api.folder(folderId);
    if (folder.path_lower.split("/").length !== 2) {
      throw new ServiceError("DROPBOX_FOLDER_SCOPE", 422, "Select a direct child of Apps/Quire");
    }
    ProjectPathSchema.parse(folder.path_display.slice(1));
    const enrolledId = IdSchema.safeParse(folder.path_lower.slice(1));
    if (enrolledId.success && await this.services.context.db.get(
      "SELECT 1 FROM dropbox_sync WHERE grant_id=? AND project_id=?", [context.grant.id, enrolledId.data])) {
      throw new ServiceError("DROPBOX_ALREADY_CONNECTED", 409, "This UUID folder already belongs to an enrolled project; open that project instead");
    }
    const listing = await api.entries(folder.id, true, limits.uploadEntries);
    const files: RemoteFile[] = [];
    const entries: NativeFile[] = [];
    const paths = new Set<string>();
    let bytes = 0;
    for (const raw of listing.entries) {
      if (raw["is_downloadable"] === false || raw["symlink_info"]) {
        throw new ServiceError("DROPBOX_UNSUPPORTED_FILE", 422, "Folder contains a non-downloadable file or symbolic link");
      }
      const entry = raw[".tag"] === "folder" ? remoteFolder.parse(raw) : remoteFile.parse(raw);
      if (!entry.path_lower.startsWith(`${folder.path_lower}/`)
        || entry.path_display.toLowerCase() !== entry.path_lower) {
        throw new ServiceError("DROPBOX_FOLDER_SCOPE", 422, "Dropbox returned content outside the selected directory");
      }
      const path = ProjectPathSchema.parse(entry.path_display.slice(folder.path_display.length + 1));
      if (generatedPath(path) || path.toLowerCase() === ".quire-generated") continue;
      if (paths.has(path.toLowerCase())) throw new ServiceError("PATH_CONFLICT", 409, "Dropbox contains colliding source paths");
      paths.add(path.toLowerCase());
      if (entry[".tag"] === "folder") entries.push({ path, folder: true, bytes: new Uint8Array() });
      else { files.push(entry); bytes += entry.size; }
    }
    if (bytes > limits.uploadBytes) throw new ServiceError("UPLOAD_LIMIT", 413, "Dropbox folder exceeds the import byte limit");
    for (const file of files) entries.push({
      path: file.path_display.slice(folder.path_display.length + 1), bytes: await api.download(file),
    });
    const mainPaths = entries.filter(entry => !entry.folder && entry.path.endsWith(".tex")
      && decodeText(entry.bytes)?.includes("\\documentclass")).map(entry => entry.path);
    if (!mainPaths.length) throw new ServiceError("INVALID_MAIN", 422, "Folder needs an editable .tex main containing documentclass; no project was created");
    return { folder, files, entries, cursor: listing.cursor, mainPaths, bytes };
  }
  async inspect(context: ActionContext, folderId: string): Promise<PreparedAction> {
    const read = await this.readFolder(context, folderId);
    const binding = await this.binding(context, folderId);
    const pending = reservation.nullable().parse(await this.services.context.db.get(
      "SELECT * FROM dropbox_folder_imports WHERE grant_id=? AND folder_id=? AND actor_id=?",
      [context.grant.id, folderId, context.actorId]));
    const prepared = pending?.payload_json ? preparedImport.parse(JSON.parse(pending.payload_json)) : null;
    const selection = pending && prepared ? folderImport.parse(JSON.parse(pending.parameters_json)) : null;
    return { result: {
      folder: { id: read.folder.id, path: read.folder.path_display, projectId: binding?.project_id ?? null },
      mainPaths: [...new Set([...read.mainPaths, ...(selection ? [selection.mainPath] : [])])],
      bytes: read.bytes, fileCount: read.files.length,
      pendingImport: selection && prepared ? {
        name: selection.name, mainPath: selection.mainPath, preparedAt: prepared.source.snapshot.createdAt,
        requiresReauthorization: prepared.grantVersion !== context.grant.version
          || prepared.configVersion !== context.configuration.version,
      } : null,
    }, cursor: null, publish: tx => this.policies.assertImport(context.actorId, tx) };
  }
  async import(context: ActionContext, selection: Selection, reauthorize = false): Promise<PreparedAction> {
    await this.policies.assertImport(context.actorId);
    const existing = await this.binding(context, selection.folderId);
    if (existing) return {
      result: { projectId: existing.project_id, folderId: selection.folderId, path: existing.path, recovered: false },
      cursor: null, publish: async tx => {
        await this.policies.assertImport(context.actorId, tx);
        await this.policies.assert(context.actorId, existing.project_id, tx);
        const project = await new CoreProjects({ ...this.services.context, db: tx }).getProject(existing.project_id);
        if (project.ownerId !== context.actorId) throw new ServiceError("FORBIDDEN", 403, "Project ownership changed");
      },
    };
    const { context: runtime } = this.services;
    // A reservation is not a project or binding. It fixes identity before any Git object is written.
    const reserved = await runtime.uow.run(async tx => {
      await tx.lock(`dropbox:folder:${context.grant.id}:${selection.folderId}`);
      await this.policies.assertImport(context.actorId, tx);
      if (reauthorize && !await tx.get(`SELECT 1 FROM dropbox_folder_imports
        WHERE grant_id=? AND folder_id=? AND actor_id=? AND payload_json IS NOT NULL`,
      [context.grant.id, selection.folderId, context.actorId])) {
        throw new ServiceError("DROPBOX_IMPORT_NOT_PREPARED", 409, "There is no prepared import to reauthorize");
      }
      await tx.run(`INSERT INTO dropbox_folder_imports(grant_id,folder_id,project_id,actor_id,parameters_json)
        VALUES(?,?,?,?,?) ON CONFLICT(grant_id,folder_id) DO NOTHING`,
      [context.grant.id, selection.folderId, crypto.randomUUID(), context.actorId, JSON.stringify(selection)]);
      const row = reservation.parse(await tx.get("SELECT * FROM dropbox_folder_imports WHERE grant_id=? AND folder_id=?",
        [context.grant.id, selection.folderId]));
      if (row.actor_id !== context.actorId || (row.payload_json !== null && row.parameters_json !== JSON.stringify(selection))) {
        throw new ServiceError("DROPBOX_IMPORT_CONFLICT", 409, "Resume the original folder import with its original name and main file");
      }
      if (row.payload_json === null) await tx.run(
        "UPDATE dropbox_folder_imports SET parameters_json=? WHERE grant_id=? AND folder_id=?",
        [JSON.stringify(selection), context.grant.id, selection.folderId]);
      return row;
    });
    const scope = { projectId: reserved.project_id, branch: "main" };
    const lease = await runtime.branches.acquire(scope, crypto.randomUUID(), 150_000);
    if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "Folder import has an active writer");
    try {
      let saved = reserved.payload_json === null ? null : preparedImport.parse(JSON.parse(reserved.payload_json));
      const projects = new CoreProjects(runtime);
      if (!saved) {
        const read = await this.readFolder(context, selection.folderId);
        const creation = await projects.prepareCreation(context.actorId, {
          name: selection.name, entries: read.entries, mainPath: selection.mainPath, projectId: reserved.project_id,
        });
        await runtime.repositories.initialize(reserved.project_id);
        const source = await projects.prepareSource({
          actorId: context.actorId, scope, lease, expectedRevision: 0, inputs: creation.inputs,
          creation, reason: "import",
        });
        const state = syncState.parse({ branch: "main", cursor: read.cursor, generated: false, conflicts: [],
          remote: read.files, files: source.files.filter(file => file.kind === "file").map(file => ({
            fileId: file.id, path: file.path, local: file.blob,
            remote: read.files.find(remote => remote.path_lower === `${read.folder.path_lower}/${file.path.toLowerCase()}`) ?? null,
          })) });
        saved = { actorId: context.actorId, grantVersion: context.grant.version, configVersion: context.configuration.version,
          key: context.key, project: creation.project, source, folder: read.folder, state };
        await runtime.uow.run(async tx => {
          await runtime.branches.assert(tx, lease);
          await tx.run("UPDATE dropbox_folder_imports SET payload_json=? WHERE grant_id=? AND folder_id=?",
            [JSON.stringify(saved), context.grant.id, selection.folderId]);
        });
      }
      if (saved.actorId !== context.actorId || saved.folder.id !== selection.folderId
        || saved.project.id !== reserved.project_id) {
        throw new ServiceError("DROPBOX_IMPORT_CONFLICT", 409, "Prepared folder import identity differs");
      }
      // Only this separately confirmed action may adopt current authority. Never update the
      // retained grant versions: background recovery must still fail closed if publication fails.
      if (!reauthorize && (saved.grantVersion !== context.grant.version
        || saved.configVersion !== context.configuration.version)) {
        throw new ServiceError("DROPBOX_AUTHORITY_CHANGED", 409, "Prepared folder import authority changed; it has not been published");
      }
      const folder = await new DropboxApi(this.services.http, this.endpoints, context).folder(selection.folderId);
      if (folder.path_lower !== saved.folder.path_lower) {
        throw new ServiceError("DROPBOX_FOLDER_MOVED", 409, "Selected folder moved while import was being prepared");
      }
      const source = saved.source;
      if (await runtime.db.get("SELECT 1 FROM repository_intents WHERE id=?", [source.snapshot.id])) {
        await runtime.repositories.recover(source.snapshot.id, lease);
      } else await runtime.repositories.publish({ id: source.snapshot.id, lease,
        updates: [{ ref: `refs/quire/history/${source.snapshot.id}`, expected: null, next: GitOidSchema.parse(`sha1:${source.commit}`) }] });
      const prepared = saved;
      const result = { projectId: reserved.project_id, folderId: selection.folderId,
        path: prepared.folder.path_display, recovered: prepared.key !== context.key };
      return { result, cursor: null, release: () => runtime.branches.release(lease), publish: async tx => {
        await this.policies.assertImport(context.actorId, tx);
        const events = await projects.finalizePreparedSources(tx, {
          publication: { id: source.snapshot.id, lease },
          sources: [{ source, lease, creation: prepared.project }],
        });
        await this.policies.assert(context.actorId, reserved.project_id, tx);
        await tx.run("INSERT INTO dropbox_folder_bindings(grant_id,folder_id,project_id,path) VALUES(?,?,?,?)",
          [context.grant.id, selection.folderId, reserved.project_id, prepared.folder.path_display]);
        await new DropboxStore(this.services).finish(tx, { grantId: context.grant.id, projectId: reserved.project_id, state: prepared.state });
        await tx.run("DELETE FROM dropbox_folder_imports WHERE grant_id=? AND folder_id=?", [context.grant.id, selection.folderId]);
        for (const event of events) await runtime.events.record(tx, event);
        if (prepared.key !== context.key) await this.reconcile(tx, context.actorId, prepared.key, result);
      } };
    } catch (error) { await runtime.branches.release(lease); throw error; }
  }
  private async reconcile(tx: Transaction, actorId: Id, key: string, result: Readonly<Record<string, unknown>>) {
    const row = z.object({ id: IdSchema }).parse(await tx.get("SELECT id FROM operations WHERE actor_id=? AND idempotency_key=?", [actorId, key]));
    await tx.run("UPDATE operations SET status='succeeded',progress=1,error_code=NULL,result_json=?,version=version+1,updated_at=? WHERE id=?",
      [JSON.stringify(result), this.services.context.clock.now(), row.id]);
    await this.services.context.events.record(tx, { topic: "operation.changed", aggregateId: row.id,
      payload: { resourceId: row.id, status: "succeeded" } });
  }
  async recover(definition: AdapterDefinition) {
    const failures: { grantId: string; projectId: string; code: string }[] = [];
    const pending = await this.services.context.db.query("SELECT grant_id,folder_id FROM dropbox_folder_imports WHERE payload_json IS NOT NULL",
      [], z.object({ grant_id: IdSchema, folder_id: z.string() }));
    for (const row of pending) {
      const saved = reservation.parse(await this.services.context.db.get(
        "SELECT * FROM dropbox_folder_imports WHERE grant_id=? AND folder_id=?", [row.grant_id, row.folder_id]));
      try {
        const grant = await this.services.grants.read(saved.actor_id, row.grant_id);
        await this.services.operations.execute(definition, {
          actorId: saved.actor_id, grantId: row.grant_id, expectedVersion: grant.version,
          expectedCursor: null, action: "importFolder", key: crypto.randomUUID(),
          parameters: folderImport.parse(JSON.parse(saved.parameters_json)),
        });
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        failures.push({ grantId: row.grant_id, projectId: saved.project_id,
          code: "code" in error && typeof error.code === "string" ? error.code : "DROPBOX_IMPORT_RECOVERY_FAILED" });
      }
    }
    return failures;
  }
}
