import type { Id, TemplateVersion, Transaction } from "@quire/contracts";
import type { HttpReceipt } from "../base";
import { saveHttp } from "../base/receipts";
import type { ModuleContext } from "@quire/runtime";
import { templateRow, versionRow, newId, fail, compare, projects } from "./storage";
import type { Template } from "./storage";

export type TemplateFields = {
  readonly name: string; readonly category: string; readonly description: string; readonly license: string;
  readonly visibility: TemplateVersion["visibility"]; readonly sourceProjectId: Id;
};
export class Templates {
  constructor(readonly context: ModuleContext) {}
  withTransaction(tx: Transaction): Templates {
    return new Templates({ ...this.context, db: tx });
  }
  async template(id: Id): Promise<Template> {
    const row = (await this.context.db.get("SELECT * FROM templates WHERE id=?", [id]));
    if (!row) fail("NOT_FOUND", 404, "Template not found");
    return templateRow.parse(row);
  }
  async version(template: Template, id: Id): Promise<TemplateVersion> {
    const row = (await this.context.db.get("SELECT * FROM template_versions WHERE id=? AND template_id=?", [id, template.id]));
    if (!row) fail("NOT_FOUND", 404, "Template version not found");
    return { ...versionRow(row), version: template.version };
  }
  async member(actorId: Id, organizationId: Id | null): Promise<boolean> {
    return organizationId !== null && !!(await this.context.db.get("SELECT 1 FROM members WHERE organization_id=? AND user_id=?", [organizationId, actorId]));
  }
  async role(actorId: Id, role: "curator" | "template-publisher", organizationId: Id | null): Promise<boolean> {
    return !!(await this.context.db.get("SELECT 1 FROM users WHERE id=? AND operator=1 AND suspended=0 AND deleted_at IS NULL", [actorId]))
      || !!(await this.context.db.get("SELECT 1 FROM catalog_roles WHERE user_id=? AND role=? AND (scope='*' OR scope=?)", [actorId, role, organizationId ?? ""]));
  }
  author(actorId: Id, template: Template): void {
    if (template.author_id !== actorId) fail("FORBIDDEN", 403, "Only the template author may change this resource");
  }
  async visible(actorId: Id | null, template: Template): Promise<TemplateVersion | null> {
    if (actorId === template.author_id && template.current_version_id) return (await this.version(template, template.current_version_id));
    if (!template.published_version_id) return null;
    const version = (await this.version(template, template.published_version_id));
    if (version.status !== "published") return null;
    if (version.visibility === "public" || (actorId && version.visibility === "organization" && (await this.member(actorId, version.organizationId)))) return version;
    return null;
  }
  async get(actorId: Id | null, id: Id): Promise<TemplateVersion> {
    const template = (await this.template(id));
    const visible = (await this.visible(actorId, template));
    if (!visible) fail("NOT_FOUND", 404, "Template not found");
    return visible;
  }
  async list(actorId: Id | null): Promise<readonly TemplateVersion[]> {
    const rows = await this.context.db.all("SELECT * FROM templates ORDER BY id");
    const visible = [];
    for (const row of rows) {
      const version = await this.visible(actorId, templateRow.parse(row));
      if (version) visible.push(version);
    }
    return visible;
  }
  async administration(): Promise<readonly TemplateVersion[]> {
    const rows = await this.context.db.all("SELECT * FROM templates WHERE current_version_id IS NOT NULL ORDER BY id");
    return Promise.all(rows.map(async row => {
      const template = templateRow.parse(row);
      if (!template.current_version_id) fail("NOT_FOUND", 404, "Template has no current version");
      return this.version(template, template.current_version_id);
    }));
  }
  validate(fields: Pick<TemplateFields, "name" | "license" | "visibility">, organizationId: Id | null): void {
    if (!fields.name.trim() || !fields.license.trim()) fail("LICENSE_REQUIRED", 422, "A template needs a name and explicit license");
    if (fields.visibility === "organization" && !organizationId) fail("ORGANIZATION_REQUIRED", 422, "Organization templates require an organization source project");
  }
  async insertVersion(tx: Transaction, template: Template, snapshotId: Id): Promise<TemplateVersion> {
    const id = newId();
    (await tx.run(`INSERT INTO template_versions
      (id,template_id,snapshot_id,name,category,description,license,visibility,status,organization_id,version,created_at)
      VALUES(?,?,?,?,?,?,?,?,'draft',?,?,?)`, [id, template.id, snapshotId, template.name, template.category, template.description, template.license, template.visibility, template.organization_id, template.version, this.context.clock.now()]));
    (await tx.run("UPDATE templates SET current_version_id=? WHERE id=?", [id, template.id]));
    return this.withTransaction(tx).version(template, id);
  }
  async create(actorId: Id, fields: TemplateFields, receipt?: HttpReceipt): Promise<TemplateVersion> {
    const source = projects(this.context);
    const project = (await source.getProject(fields.sourceProjectId));
    const scope = { projectId: project.id, branch: project.defaultBranch };
    await source.authorize(actorId, scope, "read");
    this.validate(fields, project.workspaceId);
    const snapshot = await source.snapshot(actorId, scope, (await source.getBranch(scope)).revision);
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:catalog");
      const service = this.withTransaction(tx);
      const id = newId();
      (await tx.run(`INSERT INTO templates
        (id,author_id,organization_id,name,category,description,license,visibility,created_at,source_project_id)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, [id, actorId, project.workspaceId, fields.name, fields.category, fields.description, fields.license, fields.visibility, this.context.clock.now(), project.id]));
      await source.withTransaction(tx).authorize(actorId, scope, "read");
      const result = await service.insertVersion(tx, (await service.template(id)), snapshot.id);
      await saveHttp({ ...this.context, db: tx }, receipt, result, result.version);
      return result;
    });
  }
  async patch(actorId: Id, input: { readonly [K in keyof TemplateFields]?: TemplateFields[K] | undefined } & { readonly id: Id; readonly expectedVersion: number }) {
    const template = (await this.template(input.id));
    this.author(actorId, template);
    compare(template.version, input.expectedVersion);
    if (!template.current_version_id) fail("NOT_FOUND", 404, "Template has no current version");
    const previous = (await this.version(template, template.current_version_id));
    if (previous.status !== "draft") fail("IMMUTABLE_VERSION", 409, "Create a new draft version before editing");
    const source = projects(this.context);
    let snapshotId = previous.snapshotId;
    let sourceProjectId = template.source_project_id;
    let organizationId = template.organization_id;
    if (input.sourceProjectId) {
      const project = (await source.getProject(input.sourceProjectId));
      const scope = { projectId: project.id, branch: project.defaultBranch };
      await source.authorize(actorId, scope, "read");
      snapshotId = (await source.snapshot(actorId, scope, (await source.getBranch(scope)).revision)).id;
      sourceProjectId = project.id;
      organizationId = project.workspaceId;
    }
    const name = input.name ?? template.name;
    const license = input.license ?? template.license;
    const visibility = input.visibility ?? template.visibility;
    this.validate({ name, license, visibility }, organizationId);
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:catalog");
      const service = this.withTransaction(tx);
      compare((await service.template(template.id)).version, input.expectedVersion);
      if (input.sourceProjectId) await source.withTransaction(tx).authorize(actorId, (await source.withTransaction(tx).getSnapshot(snapshotId)).scope, "read");
      (await tx.run(`UPDATE templates SET name=?,category=?,description=?,license=?,visibility=?,
        organization_id=?,source_project_id=?,version=version+1 WHERE id=?`, [name, input.category ?? template.category, input.description ?? template.description, license, visibility, organizationId, sourceProjectId, template.id]));
      (await tx.run(`UPDATE template_versions SET snapshot_id=?,name=?,category=?,description=?,license=?,
        visibility=?,organization_id=?,version=version+1 WHERE id=?`, [snapshotId, name, input.category ?? template.category, input.description ?? template.description, license, visibility, organizationId, previous.id]));
      return (await service.version((await service.template(template.id)), previous.id));
    });
  }
  async newVersion(actorId: Id, input: { readonly id: Id; readonly snapshotId: Id; readonly expectedVersion: number }, receipt?: HttpReceipt) {
    const template = (await this.template(input.id));
    this.author(actorId, template);
    compare(template.version, input.expectedVersion);
    const source = projects(this.context);
    const snapshot = (await source.getSnapshot(input.snapshotId));
    if (snapshot.scope.projectId !== template.source_project_id) fail("SNAPSHOT_SOURCE_MISMATCH", 422, "Version snapshot must belong to the template source project");
    await source.authorize(actorId, snapshot.scope, "read");
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:catalog");
      const service = this.withTransaction(tx);
      compare((await service.template(template.id)).version, input.expectedVersion);
      (await tx.run("UPDATE templates SET version=version+1 WHERE id=?", [template.id]));
      await source.withTransaction(tx).authorize(actorId, snapshot.scope, "read");
      const result = await service.insertVersion(tx, (await service.template(template.id)), snapshot.id);
      await saveHttp({ ...this.context, db: tx }, receipt, result, result.version);
      return result;
    });
  }
  async delete(actorId: Id, input: { readonly id: Id; readonly expectedVersion: number }) {
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:catalog");
      const service = this.withTransaction(tx);
      const template = (await service.template(input.id));
      this.author(actorId, template);
      compare(template.version, input.expectedVersion);
      (await tx.run("DELETE FROM template_versions WHERE template_id=?", [template.id]));
      (await tx.run("DELETE FROM templates WHERE id=?", [template.id]));
      return { ok: true as const, version: template.version + 1 };
    });
  }
}
