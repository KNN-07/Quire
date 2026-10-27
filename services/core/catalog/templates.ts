import type { Id, TemplateVersion } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { templateRow, versionRow, newId, fail, compare, projects } from "./storage";
import type { Template } from "./storage";

export type TemplateFields = {
  readonly name: string; readonly category: string; readonly description: string; readonly license: string;
  readonly visibility: TemplateVersion["visibility"]; readonly sourceProjectId: Id;
};
export class Templates {
  constructor(readonly context: ModuleContext) {}
  template(id: Id): Template {
    const row = this.context.db.query("SELECT * FROM templates WHERE id=?").get(id);
    if (!row) fail("NOT_FOUND", 404, "Template not found");
    return templateRow.parse(row);
  }
  version(template: Template, id: Id): TemplateVersion {
    const row = this.context.db.query("SELECT * FROM template_versions WHERE id=? AND template_id=?").get(id, template.id);
    if (!row) fail("NOT_FOUND", 404, "Template version not found");
    return { ...versionRow(row), version: template.version };
  }
  member(actorId: Id, organizationId: Id | null): boolean {
    return organizationId !== null && !!this.context.db.query("SELECT 1 FROM members WHERE organization_id=? AND user_id=?")
      .get(organizationId, actorId);
  }
  role(actorId: Id, role: "curator" | "template-publisher", organizationId: Id | null): boolean {
    return !!this.context.db.query("SELECT 1 FROM users WHERE id=? AND operator=1 AND suspended=0 AND deleted_at IS NULL").get(actorId)
      || !!this.context.db.query("SELECT 1 FROM catalog_roles WHERE user_id=? AND role=? AND (scope='*' OR scope=?)")
        .get(actorId, role, organizationId ?? "");
  }
  author(actorId: Id, template: Template): void {
    if (template.author_id !== actorId) fail("FORBIDDEN", 403, "Only the template author may change this resource");
  }
  visible(actorId: Id | null, template: Template): TemplateVersion | null {
    if (actorId === template.author_id && template.current_version_id) return this.version(template, template.current_version_id);
    if (!template.published_version_id) return null;
    const version = this.version(template, template.published_version_id);
    if (version.status !== "published") return null;
    if (version.visibility === "public" || (actorId && version.visibility === "organization" && this.member(actorId, version.organizationId))) return version;
    return null;
  }
  get(actorId: Id | null, id: Id): TemplateVersion {
    const template = this.template(id);
    const visible = this.visible(actorId, template);
    if (!visible) fail("NOT_FOUND", 404, "Template not found");
    return visible;
  }
  list(actorId: Id | null): readonly TemplateVersion[] {
    return this.context.db.query("SELECT * FROM templates ORDER BY id").all()
      .map(row => this.visible(actorId, templateRow.parse(row))).filter(version => version !== null);
  }
  administration(): readonly TemplateVersion[] {
    return this.context.db.query("SELECT * FROM templates WHERE current_version_id IS NOT NULL ORDER BY id").all()
      .map(row => {
        const template = templateRow.parse(row);
        if (!template.current_version_id) fail("NOT_FOUND", 404, "Template has no current version");
        return this.version(template, template.current_version_id);
      });
  }
  validate(fields: Pick<TemplateFields, "name" | "license" | "visibility">, organizationId: Id | null): void {
    if (!fields.name.trim() || !fields.license.trim()) fail("LICENSE_REQUIRED", 422, "A template needs a name and explicit license");
    if (fields.visibility === "organization" && !organizationId) fail("ORGANIZATION_REQUIRED", 422, "Organization templates require an organization source project");
  }
  insertVersion(template: Template, snapshotId: Id): TemplateVersion {
    const id = newId();
    this.context.db.query(`INSERT INTO template_versions
      (id,template_id,snapshot_id,name,category,description,license,visibility,status,organization_id,version,created_at)
      VALUES(?,?,?,?,?,?,?,?,'draft',?,?,?)`).run(id, template.id, snapshotId, template.name, template.category,
      template.description, template.license, template.visibility, template.organization_id, template.version, this.context.clock.now());
    this.context.db.query("UPDATE templates SET current_version_id=? WHERE id=?").run(id, template.id);
    return this.version(template, id);
  }
  async create(actorId: Id, fields: TemplateFields): Promise<TemplateVersion> {
    const source = projects(this.context);
    const project = source.getProject(fields.sourceProjectId);
    const scope = { projectId: project.id, branch: project.defaultBranch };
    await source.authorize(actorId, scope, "read");
    this.validate(fields, project.workspaceId);
    const snapshot = await source.snapshot(actorId, scope, source.getBranch(scope).revision);
    return this.context.uow.local(() => {
      const id = newId();
      this.context.db.query(`INSERT INTO templates
        (id,author_id,organization_id,name,category,description,license,visibility,created_at,source_project_id)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, actorId, project.workspaceId, fields.name, fields.category,
        fields.description, fields.license, fields.visibility, this.context.clock.now(), project.id);
      return this.insertVersion(this.template(id), snapshot.id);
    });
  }
  async patch(actorId: Id, input: { readonly [K in keyof TemplateFields]?: TemplateFields[K] | undefined } & { readonly id: Id; readonly expectedVersion: number }) {
    const template = this.template(input.id);
    this.author(actorId, template);
    compare(template.version, input.expectedVersion);
    if (!template.current_version_id) fail("NOT_FOUND", 404, "Template has no current version");
    const previous = this.version(template, template.current_version_id);
    if (previous.status !== "draft") fail("IMMUTABLE_VERSION", 409, "Create a new draft version before editing");
    const source = projects(this.context);
    let snapshotId = previous.snapshotId;
    let sourceProjectId = template.source_project_id;
    let organizationId = template.organization_id;
    if (input.sourceProjectId) {
      const project = source.getProject(input.sourceProjectId);
      const scope = { projectId: project.id, branch: project.defaultBranch };
      await source.authorize(actorId, scope, "read");
      snapshotId = (await source.snapshot(actorId, scope, source.getBranch(scope).revision)).id;
      sourceProjectId = project.id;
      organizationId = project.workspaceId;
    }
    const name = input.name ?? template.name;
    const license = input.license ?? template.license;
    const visibility = input.visibility ?? template.visibility;
    this.validate({ name, license, visibility }, organizationId);
    return this.context.uow.local(() => {
      compare(this.template(template.id).version, input.expectedVersion);
      this.context.db.query(`UPDATE templates SET name=?,category=?,description=?,license=?,visibility=?,
        organization_id=?,source_project_id=?,version=version+1 WHERE id=?`).run(name, input.category ?? template.category,
        input.description ?? template.description, license, visibility, organizationId, sourceProjectId, template.id);
      this.context.db.query(`UPDATE template_versions SET snapshot_id=?,name=?,category=?,description=?,license=?,
        visibility=?,organization_id=?,version=version+1 WHERE id=?`).run(snapshotId, name, input.category ?? template.category,
        input.description ?? template.description, license, visibility, organizationId, previous.id);
      return this.version(this.template(template.id), previous.id);
    });
  }
  async newVersion(actorId: Id, input: { readonly id: Id; readonly snapshotId: Id; readonly expectedVersion: number }) {
    const template = this.template(input.id);
    this.author(actorId, template);
    compare(template.version, input.expectedVersion);
    const source = projects(this.context);
    const snapshot = source.getSnapshot(input.snapshotId);
    if (snapshot.scope.projectId !== template.source_project_id) fail("SNAPSHOT_SOURCE_MISMATCH", 422, "Version snapshot must belong to the template source project");
    await source.authorize(actorId, snapshot.scope, "read");
    return this.context.uow.local(() => {
      compare(this.template(template.id).version, input.expectedVersion);
      this.context.db.query("UPDATE templates SET version=version+1 WHERE id=?").run(template.id);
      return this.insertVersion(this.template(template.id), snapshot.id);
    });
  }
  delete(actorId: Id, input: { readonly id: Id; readonly expectedVersion: number }) {
    return this.context.uow.local(() => {
      const template = this.template(input.id);
      this.author(actorId, template);
      compare(template.version, input.expectedVersion);
      this.context.db.query("DELETE FROM template_versions WHERE template_id=?").run(template.id);
      this.context.db.query("DELETE FROM templates WHERE id=?").run(template.id);
      return { ok: true as const, version: template.version + 1 };
    });
  }
}
