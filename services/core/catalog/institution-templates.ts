import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id, TemplateVersion } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { compare, fail } from "./storage";
import { Templates } from "./templates";

export class InstitutionTemplates {
  constructor(readonly context: ModuleContext) {}
  async institution(id: Id) {
    if (!await this.context.db.get("SELECT id FROM organizations WHERE id=? AND kind='institution'", [id]))
      fail("NOT_FOUND", 404, "Institution not found");
  }
  async administer(actorId: Id, organizationId: Id) {
    await this.institution(organizationId);
    const grant = await this.context.db.get(`SELECT u.id FROM users u WHERE u.id=?
      AND u.suspended=0 AND u.deleted_at IS NULL AND (u.operator=1 OR EXISTS(
        SELECT 1 FROM members m WHERE m.organization_id=? AND m.user_id=u.id AND m.role='admin'))`,
    [actorId, organizationId]);
    if (!grant) fail("FORBIDDEN", 403, "Institution administrator required");
  }
  async list(actorId: Id | null, organizationId: Id): Promise<readonly TemplateVersion[]> {
    await this.institution(organizationId);
    const rows = await this.context.db.all(`SELECT s.template_id,s.version_id FROM institution_templates s
      JOIN templates t ON t.id=s.template_id AND t.published_version_id=s.version_id
      JOIN template_versions v ON v.id=s.version_id AND v.status='published'
      WHERE s.organization_id=? ORDER BY s.template_id`, [organizationId]);
    const templates = new Templates(this.context);
    const result: TemplateVersion[] = [];
    for (const row of rows) {
      const selection = z.object({ template_id: IdSchema, version_id: IdSchema }).parse(row);
      const version = await templates.version(await templates.template(selection.template_id), selection.version_id);
      if (version.visibility === "public" || (version.visibility === "organization"
        && version.organizationId === organizationId && actorId && await templates.member(actorId, organizationId)))
        result.push(version);
    }
    return result;
  }
  async select(actorId: Id, organizationId: Id, templateId: Id, versionId: Id, expectedVersion: number) {
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:catalog");
      const bound = { ...this.context, db: tx };
      await new InstitutionTemplates(bound).administer(actorId, organizationId);
      const templates = new Templates(bound);
      const template = await templates.template(templateId);
      compare(template.version, expectedVersion);
      const version = await templates.version(template, versionId);
      if (template.published_version_id !== version.id || version.status !== "published")
        fail("PUBLICATION_REQUIRED", 409, "Select the currently published approved version");
      if (version.visibility !== "public" && !(version.visibility === "organization" && version.organizationId === organizationId))
        fail("FORBIDDEN", 403, "Template is outside the institution audience");
      await tx.run(`INSERT INTO institution_templates(organization_id,template_id,version_id) VALUES(?,?,?)
        ON CONFLICT(organization_id,template_id) DO UPDATE SET version_id=excluded.version_id`,
      [organizationId, templateId, version.id]);
      await tx.run("UPDATE templates SET version=version+1 WHERE id=?", [templateId]);
      return templates.version(await templates.template(templateId), version.id);
    });
  }
  async remove(actorId: Id, organizationId: Id, templateId: Id, expectedVersion: number) {
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:catalog");
      const bound = { ...this.context, db: tx };
      await new InstitutionTemplates(bound).administer(actorId, organizationId);
      const template = await new Templates(bound).template(templateId);
      compare(template.version, expectedVersion);
      await tx.run("DELETE FROM institution_templates WHERE organization_id=? AND template_id=?", [organizationId, templateId]);
      await tx.run("UPDATE templates SET version=version+1 WHERE id=?", [templateId]);
      return { ok: true as const, version: template.version + 1 };
    });
  }
}
