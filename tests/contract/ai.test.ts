import { expect, test } from "bun:test";
import { AiRunSchema, endpoints } from "@quire/contracts";
import { fixtureIds as ids } from "../fixtures/foundation";

test("AI routes retain governed image, conversation and security inputs", () => {
  const input = { params: { p: ids.project }, query: {} };
  expect(endpoints.aiImageCreate.input.parse({ ...input,
    body: { mime: "image/png", dataBase64: "aW1hZ2U=" } }).body.mime).toBe("image/png");
  expect(endpoints.aiConversationCreate.input.parse({ ...input, body: { shared: true } }).body.shared).toBe(true);
  expect(endpoints.aiSecurityPut.input.parse({ ...input,
    body: { confidential: true, expectedVersion: 3 } }).body.expectedVersion).toBe(3);
  expect(endpoints.aiSessionClear.input.parse({ ...input, body: { branch: "draft" } }).body.branch).toBe("draft");
  expect(endpoints.aiUsageGet.input.safeParse({
    params: {}, query: { month: "2026-13" }, body: undefined,
  }).success).toBe(false);
  for (const route of [endpoints.aiImageCreate, endpoints.aiConversationCreate, endpoints.aiConversationGet,
    endpoints.aiUsageGet, endpoints.aiSecurityGet, endpoints.aiSecurityPut, endpoints.aiSessionClear]) {
    expect(route.lane).toBe("X");
  }
});

test("AI run metadata exposes decision version and persisted failure state", () => {
  const run = { id: ids.project, scope: { projectId: ids.project, branch: "main" },
    mode: "ask", status: "failed", tool: "chat", version: 2, errorCode: "AI_DISABLED",
    conversationId: null, messages: [], proposals: [], sources: [], usageId: ids.project };
  expect(AiRunSchema.parse(run)).toMatchObject({
    tool: "chat", version: 2, errorCode: "AI_DISABLED", conversationId: null,
  });
  expect(AiRunSchema.safeParse({ ...run, version: -1 }).success).toBe(false);
  expect(AiRunSchema.safeParse({ ...run, tool: "unregistered-tool" }).success).toBe(false);
});
