import type { Id, TemplateVersion } from "@quire/contracts";
import type { Templates } from "./templates";
import { compare, fail } from "./storage";

type Transition = {
  readonly id: Id; readonly expectedVersion: number; readonly versionId?: Id | undefined;
  readonly workspaceId?: Id | undefined; readonly status: TemplateVersion["status"];
};
/** Approval and publication are separate, version-pinned authority decisions. */
export function transition(service: Templates, actorId: Id, input: Transition) {
  return service.context.uow.local(() => {
    const template = service.template(input.id);
    compare(template.version, input.expectedVersion);
    const id = input.versionId ?? template.current_version_id;
    if (!id) fail("NOT_FOUND", 404, "Template has no current version");
    const version = service.version(template, id);
    switch (input.status) {
      case "submitted":
        service.author(actorId, template);
        if (version.status !== "draft") fail("INVALID_TEMPLATE_STATE", 409, "Only a draft can be submitted");
        break;
      case "approved":
        if (!service.role(actorId, "curator", version.organizationId)) fail("FORBIDDEN", 403, "Curator role required");
        if (version.status !== "submitted") fail("INVALID_TEMPLATE_STATE", 409, "Only a submitted version can be approved");
        break;
      case "published":
        if (!service.role(actorId, "template-publisher", version.organizationId)) fail("FORBIDDEN", 403, "Template publisher role required");
        if (version.status !== "approved") fail("APPROVAL_REQUIRED", 409, "Publish an approved version");
        if (input.workspaceId && input.workspaceId !== version.organizationId) fail("WORKSPACE_MISMATCH", 422, "Publishing cannot change the approved visibility scope");
        service.validate(version, version.organizationId);
        service.context.db.query("UPDATE template_versions SET status='unpublished' WHERE template_id=? AND status='published'").run(template.id);
        service.context.db.query("UPDATE templates SET published_version_id=? WHERE id=?").run(version.id, template.id);
        break;
      case "unpublished":
        if (!template.published_version_id) fail("INVALID_TEMPLATE_STATE", 409, "Template is not published");
        if (template.author_id !== actorId && !service.role(actorId, "template-publisher",
          service.version(template, template.published_version_id).organizationId)) fail("FORBIDDEN", 403, "Author or publisher role required");
        service.context.db.query("UPDATE template_versions SET status='unpublished' WHERE id=?").run(template.published_version_id);
        service.context.db.query("UPDATE templates SET published_version_id=NULL,version=version+1 WHERE id=?").run(template.id);
        return service.version(service.template(template.id), template.published_version_id);
      case "draft":
        return fail("INVALID_TEMPLATE_STATE", 409, "Use the new version endpoint to create a draft");
      default: {
        const exhaustive: never = input.status;
        return exhaustive;
      }
    }
    service.context.db.query("UPDATE template_versions SET status=?,version=version+1 WHERE id=?").run(input.status, version.id);
    service.context.db.query("UPDATE templates SET version=version+1 WHERE id=?").run(template.id);
    return service.version(service.template(template.id), version.id);
  });
}
