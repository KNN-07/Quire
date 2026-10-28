import type { Id, TemplateVersion } from "@quire/contracts";
import type { Templates } from "./templates";
import { compare, fail } from "./storage";

type Transition = {
  readonly id: Id; readonly expectedVersion: number; readonly versionId?: Id | undefined;
  readonly workspaceId?: Id | undefined; readonly status: TemplateVersion["status"];
};
/** Approval and publication are separate, version-pinned authority decisions. */
export async function transition(root: Templates, actorId: Id, input: Transition) {
  return root.context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.lock("quire:catalog");
    const service = root.withTransaction(tx);
    const template = (await service.template(input.id));
    compare(template.version, input.expectedVersion);
    const id = input.versionId ?? template.current_version_id;
    if (!id) fail("NOT_FOUND", 404, "Template has no current version");
    const version = (await service.version(template, id));
    switch (input.status) {
      case "submitted":
        service.author(actorId, template);
        if (version.status !== "draft") fail("INVALID_TEMPLATE_STATE", 409, "Only a draft can be submitted");
        break;
      case "approved":
        if (!(await service.role(actorId, "curator", version.organizationId))) fail("FORBIDDEN", 403, "Curator role required");
        if (version.status !== "submitted") fail("INVALID_TEMPLATE_STATE", 409, "Only a submitted version can be approved");
        break;
      case "published":
        if (!(await service.role(actorId, "template-publisher", version.organizationId))) fail("FORBIDDEN", 403, "Template publisher role required");
        if (version.status !== "approved") fail("APPROVAL_REQUIRED", 409, "Publish an approved version");
        if (input.workspaceId && input.workspaceId !== version.organizationId) fail("WORKSPACE_MISMATCH", 422, "Publishing cannot change the approved visibility scope");
        service.validate(version, version.organizationId);
        (await tx.run("UPDATE template_versions SET status='unpublished' WHERE template_id=? AND status='published'", [template.id]));
        (await tx.run("UPDATE templates SET published_version_id=? WHERE id=?", [version.id, template.id]));
        break;
      case "unpublished":
        if (!template.published_version_id) fail("INVALID_TEMPLATE_STATE", 409, "Template is not published");
        if (template.author_id !== actorId && !(await service.role(actorId, "template-publisher",
          (await service.version(template, template.published_version_id)).organizationId))) fail("FORBIDDEN", 403, "Author or publisher role required");
        (await tx.run("UPDATE template_versions SET status='unpublished' WHERE id=?", [template.published_version_id]));
        (await tx.run("UPDATE templates SET published_version_id=NULL,version=version+1 WHERE id=?", [template.id]));
        return (await service.version((await service.template(template.id)), template.published_version_id));
      case "draft":
        return fail("INVALID_TEMPLATE_STATE", 409, "Use the new version endpoint to create a draft");
      default: {
        const exhaustive: never = input.status;
        return exhaustive;
      }
    }
    (await tx.run("UPDATE template_versions SET status=?,version=version+1 WHERE id=?", [input.status, version.id]));
    (await tx.run("UPDATE templates SET version=version+1 WHERE id=?", [template.id]));
    return (await service.version((await service.template(template.id)), version.id));
  });
}
