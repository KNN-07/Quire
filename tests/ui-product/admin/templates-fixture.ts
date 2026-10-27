import { endpoints, TemplateVersionSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";

export function templatesFixture() {
  let template = TemplateVersionSchema.parse({
    id: "00000000-0000-4000-8000-000000000801", templateId: "00000000-0000-4000-8000-000000000802",
    snapshotId: fixtureIds.snapshot, name: "Research article", category: "Article", description: "An explicit template fixture.",
    license: "MIT", visibility: "public", status: "submitted", organizationId: null, version: 6,
  });
  return (request: Request, url: URL, body: unknown): Response | null => {
    if (url.pathname === "/api/admin/templates" && request.method === "GET")
      return Response.json({ requestId: fixtureIds.operator, data: { items: [template], nextCursor: null } });
    if (!url.pathname.startsWith("/api/templates")) return null;
    const fail = (message: string) => Response.json({ requestId: fixtureIds.operator,
      error: { code: "INVALID_TEMPLATE_STATE", message } }, { status: 409 });
    if (request.headers.get("x-csrf-token") !== "fixture-csrf") return fail("Missing CSRF");
    if (url.pathname === "/api/templates") {
      const input = endpoints.templateCreate.input.parse({ params: {}, query: {}, body });
      const { sourceProjectId: _source, ...fields } = input.body;
      template = TemplateVersionSchema.parse({ ...template, ...fields, id: crypto.randomUUID(),
        templateId: crypto.randomUUID(), status: "draft", version: 0 });
      return Response.json({ requestId: fixtureIds.operator, data: template });
    }
    const params = { id: template.templateId };
    if (url.pathname === `/api/templates/${template.templateId}/versions`) {
      const input = endpoints.templateVersion.input.parse({ params, query: {}, body });
      if (input.body.expectedVersion !== template.version || input.body.snapshotId !== template.snapshotId) return fail("Wrong draft source");
      template = TemplateVersionSchema.parse({ ...template, id: "00000000-0000-4000-8000-000000000803", status: "draft", version: template.version + 1 });
      return Response.json({ requestId: fixtureIds.operator, data: template });
    }
    if (url.pathname === `/api/templates/${template.templateId}` && request.method === "PATCH") {
      const input = endpoints.templatePatch.input.parse({ params, query: {}, body });
      if (input.body.expectedVersion !== template.version || template.status !== "draft") return fail("Stale or immutable version");
      template = { ...template, name: input.body.name ?? template.name, category: input.body.category ?? template.category,
        description: input.body.description ?? template.description, license: input.body.license ?? template.license,
        visibility: input.body.visibility ?? template.visibility, version: template.version + 1 };
      return Response.json({ requestId: fixtureIds.operator, data: template });
    }
    if (url.pathname !== `/api/templates/${template.templateId}/approve` &&
      url.pathname !== `/api/templates/${template.templateId}/publish`) return fail("Unexpected template action");
    const input = endpoints.templateApprove.input.parse({ params, query: {}, body });
    if (input.body.versionId !== template.id || input.body.expectedVersion !== template.version) return fail("Wrong version identity");
    if (url.pathname.endsWith("/approve")) {
      if (template.status !== "submitted") return fail("Submission required");
      template = { ...template, status: "approved", version: template.version + 1 };
    } else {
      if (template.status !== "approved") return fail("Approval required");
      template = { ...template, status: "published", version: template.version + 1 };
    }
    return Response.json({ requestId: fixtureIds.operator, data: template });
  };
}
