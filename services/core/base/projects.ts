import { z } from "zod";
import { FileEntrySchema, ProjectSchema, ProposedEditSchema, AnchorSchema, IdSchema, assertNever } from "@quire/contracts";
import type { Id, Project, CompileSettings } from "@quire/contracts";
import { SourceService } from "./source";
import { compare, fail, newId } from "./store";
import { initializeRepository } from "./git-checkpoint";
import { decodeText, checkFiles } from "./limits";
import type { SourceInput } from "./source-records";

export type NativeFile = { readonly path: string; readonly bytes: Uint8Array; readonly folder?: boolean };
export class CoreProjects extends SourceService {
  async create(actorId: Id, input: {
    readonly name: string; readonly workspaceId?: Id | undefined;
    readonly origin: { readonly kind: "blank" | "example" } | { readonly kind: "template"; readonly templateVersionId: Id };
  }): Promise<Project> {
    let entries: readonly NativeFile[];
    switch (input.origin.kind) {
      case "blank":
        entries = [{ path: "main.tex", bytes: new TextEncoder().encode("\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n") }];
        break;
      case "example":
        entries = [
          { path: "main.tex", bytes: new TextEncoder().encode("\\documentclass{article}\n\\title{Example}\n\\begin{document}\n\\maketitle\n\\input{sections/introduction}\n\\end{document}\n") },
          { path: "sections/introduction.tex", bytes: new TextEncoder().encode("\\section{Introduction}\nHello, Quire!\n") },
        ];
        break;
      case "template": {
        const version = this.one("SELECT * FROM template_versions WHERE id=?", [input.origin.templateVersionId], z.object({
          snapshot_id: z.string(), template_id: z.string(), status: z.string(), visibility: z.string(),
          organization_id: z.string().nullable(),
        }));
        const template = this.one("SELECT author_id FROM templates WHERE id=?", [version.template_id],
          z.object({ author_id: z.string() }));
        const member = version.organization_id && this.context.db.query(
          "SELECT 1 FROM members WHERE organization_id=? AND user_id=?").get(version.organization_id, actorId);
        if ((version.status !== "approved" && version.status !== "published")
          || (template.author_id !== actorId && (version.status !== "published"
            || (version.visibility !== "public" && !(version.visibility === "organization" && member))))) {
          fail("NOT_FOUND", 404, "Template version not found");
        }
        const snapshot = await this.readSnapshot(IdSchema.parse(version.snapshot_id));
        entries = await Promise.all(snapshot.files.map(async (file) => ({
          path: file.path, folder: file.kind === "folder",
          bytes: file.blob ? await this.context.blobs.get(file.blob) : new Uint8Array(),
        })));
        break;
      }
      default: return assertNever(input.origin);
    }
    return this.createFromFiles(actorId, { name: input.name, entries, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}) });
  }
  async createFromFiles(actorId: Id, input: {
    readonly name: string; readonly entries: readonly NativeFile[]; readonly workspaceId?: Id;
  }): Promise<Project> {
    this.readUser(actorId);
    if (input.workspaceId && !this.context.db.query("SELECT 1 FROM members WHERE organization_id=? AND user_id=?")
      .get(input.workspaceId, actorId)) fail("FORBIDDEN", 403, "Workspace membership required");
    const environment = this.one(`SELECT id FROM environments WHERE retired_at IS NULL
      ORDER BY available DESC,is_default DESC,created_at DESC,id LIMIT 1`, [], z.object({ id: z.string() }));
    const projectId = newId();
    const branchId = newId();
    const inputs: SourceInput[] = input.entries.map((entry) => ({
      file: FileEntrySchema.parse({ id: newId(), path: entry.path, kind: entry.folder ? "folder" : "file",
        mime: entry.folder ? "inode/directory" : (decodeText(entry.bytes) === null ? "application/octet-stream" : "text/plain"),
        blob: null, bytes: entry.folder ? 0 : entry.bytes.length,
        editable: !entry.folder && decodeText(entry.bytes) !== null, version: { revision: 0, epoch: 0 }, link: null }),
      ...(entry.folder ? {} : { bytes: entry.bytes }),
    }));
    checkFiles(inputs.map((item) => item.file));
    const main = inputs.find((item) => item.file.path.endsWith(".tex") && item.bytes
      && decodeText(item.bytes)?.includes("\\documentclass"));
    if (!main) fail("INVALID_MAIN", 422, "Import needs an editable TeX main containing documentclass");
    const now = this.context.clock.now();
    const settings = { engine: "pdflatex", mainFileId: main.file.id, environmentId: environment.id,
      draft: false, stopOnFirstError: false };
    await initializeRepository(this.context, projectId);
    this.context.uow.local((tx) => {
      tx.query(`INSERT INTO projects(id,name,owner_id,workspace_id,settings_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`).run(projectId, input.name, actorId, input.workspaceId ?? null, JSON.stringify(settings), now, now);
      tx.query("INSERT INTO branch_workspaces(id,project_id,branch,created_at,updated_at) VALUES(?,?,'main',?,?)")
        .run(branchId, projectId, now, now);
      tx.query("INSERT INTO repositories(project_id,relative_path,created_at) VALUES(?,?,?)")
        .run(projectId, `git/${projectId}.git`, now);
    });
    await this.serialized({ projectId, branch: "main" }, () => this.commitSource({
      actorId, scope: { projectId, branch: "main" }, expectedRevision: 0, inputs, reason: "import",
    }));
    return this.getProject(projectId);
  }
  async copy(actorId: Id, input: { readonly projectId: Id; readonly name: string; readonly expectedVersion: number; readonly request?: Request }) {
    const source = this.getProject(input.projectId);
    const scope = { projectId: source.id, branch: source.defaultBranch };
    if (input.request) await this.authorizeRequest(input.request, scope, "copy");
    else await this.authorize(actorId, scope, "copy");
    compare(source.version, input.expectedVersion);
    const pending = this.rows(`SELECT e.* FROM suggestion_edits e JOIN suggestions s ON s.id=e.suggestion_id
      WHERE s.project_id=? AND s.branch=? AND e.status='pending' ORDER BY e.id`, [source.id, scope.branch], z.object({
      id: z.string(), file_id: z.string(), anchor_json: z.string(), before_text: z.string(), after_text: z.string(), base_revision: z.number(),
    }));
    const entries: NativeFile[] = [];
    for (const file of this.listFiles(scope)) {
      let bytes = file.blob ? await this.context.blobs.get(file.blob) : new Uint8Array();
      const edits = pending.filter((edit) => edit.file_id === file.id);
      if (file.editable && edits.length) {
        const { applyCopyEdits } = await import("./copy-edits");
        bytes = applyCopyEdits(this.loadDocument(scope, file.id), edits.map((edit) => ProposedEditSchema.parse({
          id: edit.id, fileId: edit.file_id, anchor: AnchorSchema.parse(JSON.parse(edit.anchor_json)),
          before: edit.before_text, after: edit.after_text, baseRevision: edit.base_revision, status: "pending",
        })));
      }
      entries.push({ path: file.path, bytes, folder: file.kind === "folder" });
    }
    return this.createFromFiles(actorId, { name: input.name, entries });
  }
  async patch(actorId: Id, input: {
    readonly projectId: Id; readonly expectedVersion: number; readonly name?: string | undefined; readonly settings?: CompileSettings | undefined;
  }): Promise<Project> {
    const project = this.getProject(input.projectId);
    const scope = { projectId: project.id, branch: project.defaultBranch };
    return this.serialized(scope, async () => {
      await this.authorize(actorId, scope, "settings");
      compare(this.getProject(project.id).version, input.expectedVersion);
      if (input.settings) {
        const main = this.getFile(scope, input.settings.mainFileId);
        if (!main.editable || main.link || !main.path.endsWith(".tex")
          || (input.settings.engine !== "plain" && !this.readDocument(scope, main.id).text.includes("\\documentclass"))) {
          fail("INVALID_MAIN", 422, "Main must be editable unlinked TeX with documentclass");
        }
        this.one("SELECT id FROM environments WHERE id=? AND retired_at IS NULL", [input.settings.environmentId], z.object({ id: z.string() }));
      }
      this.context.uow.local((tx) => {
        tx.query("UPDATE projects SET name=?,settings_json=?,version=version+1,updated_at=? WHERE id=?")
          .run(input.name ?? project.name, JSON.stringify(input.settings ?? project.settings), this.context.clock.now(), project.id);
        this.context.events.append(tx, { topic: "tree.changed", aggregateId: project.id,
          payload: { resourceId: project.id, version: project.version + 1 } });
      });
      this.context.events.dispatch();
      return ProjectSchema.parse(this.getProject(project.id));
    });
  }
}
