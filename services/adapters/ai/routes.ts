import { endpoints, resourceVersionTag } from "@quire/contracts";
import type { RequestContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import type { AiService } from "./service";
import { z } from "zod";

export function registerAiRoutes(service: AiService) {
  const { context } = service.store;
  async function actor(request: RequestContext) {
    const identity = context.services.get("identity");
    const principal = await identity.require(request.request);
    if (!["GET", "HEAD"].includes(request.request.method)) await identity.verifyMutation(request.request, principal);
    return { id: principal.user.id, sessionId: principal.sessionId };
  }
  const key = (request: RequestContext) => {
    const value = request.request.headers.get("idempotency-key");
    if (!value) throw new ServiceError("IDEMPOTENCY_KEY_REQUIRED", 400, "Idempotency-Key required");
    return value;
  };
  context.routes.register(endpoints.aiRunCreate, async (input, request) => {
    if (input.params.p !== input.body.scope.projectId) throw new ServiceError("SCOPE_MISMATCH", 400, "Project path and scope differ");
    return service.create(await actor(request), { request: input.body, key: key(request) });
  });
  context.routes.register(endpoints.aiRunGet, async (input, request) => {
    const value = await service.get(await actor(request), input.params.id);
    request.responseHeaders.set("etag", resourceVersionTag(value.version));
    return value.run;
  });
  context.routes.register(endpoints.aiRunCancel, async (input, request) =>
    service.cancel(await actor(request), { id: input.params.id, ...input.body }));
  context.routes.register(endpoints.aiRunDecide, async (input, request) =>
    service.decisions.decide(await actor(request), { id: input.params.id, ...input.body, key: key(request) }));
  context.routes.register(endpoints.aiRunUndo, async (input, request) =>
    service.decisions.decide(await actor(request), { id: input.params.id, ...input.body, key: key(request), decision: "undo" }));
  context.routes.register(endpoints.aiConversationDelete, async (input, request) =>
    service.conversations.clear(await actor(request), { id: input.params.id, projectId: input.params.p, ...input.body }));
  context.routes.register(endpoints.aiImageCreate, async (input, request) =>
    service.upload(await actor(request), { projectId: input.params.p, ...input.body }));
  context.routes.register(endpoints.aiConversationCreate, async (input, request) =>
    service.conversations.create(await actor(request), input.params.p));
  context.routes.register(endpoints.aiConversationGet, async (input, request) => {
    const principal = await actor(request);
    await service.conversations.expire();
    return service.conversations.get(principal, { id: input.params.id, projectId: input.params.p });
  });
  context.routes.register(endpoints.aiUsageGet, async (input, request) =>
    service.store.usage(await actor(request), input.query.month));
  context.routes.register(endpoints.aiConsentGet, async (_input, request) => {
    const principal = await actor(request);
    const row = z.object({
      version: z.number().int(), terms_version: z.string().nullable(), accepted: z.number().nullable(),
    }).parse(await context.db.get(`SELECT u.version,c.terms_version,c.accepted FROM users u
      LEFT JOIN identity_ai_consent c ON c.user_id=u.id WHERE u.id=?`, [principal.id]));
    const requiredTermsVersion = service.store.termsVersion;
    return { requiredTermsVersion, acceptedTermsVersion: row.terms_version,
      accepted: row.accepted === 1, current: row.accepted === 1 && row.terms_version === requiredTermsVersion,
      userVersion: row.version };
  });
  context.routes.register(endpoints.aiSecurityGet, async (input, request) =>
    service.store.security(await actor(request), input.params.p));
  context.routes.register(endpoints.aiSecurityPut, async (input, request) => {
    const principal = await actor(request);
    const project = await service.store.core().getProject(input.params.p);
    return service.store.setSecurity(principal, { scope: { projectId: project.id, branch: project.defaultBranch }, ...input.body });
  });
  context.routes.register(endpoints.aiSessionClear, async (input, request) =>
    service.conversations.clearSession(await actor(request), { projectId: input.params.p, branch: input.body.branch }));
}
