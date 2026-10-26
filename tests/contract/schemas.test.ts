import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { endpoints, endpointRegistry, IdSchema, InstantSchema, DigestSchema, GitOidSchema,
  ProjectPathSchema, RealtimeClientMessageSchema, UserSchema, CompileRequestSchema } from "@quire/contracts";
import type { RequestOf, ResponseOf, EndpointName } from "@quire/contracts";
import { fixtureIds as ids, defaultPreferences, defaultPolicy } from "../fixtures/foundation";

// Compile every registered request and response from the same registry used by client and server.
export type Requests = { readonly [K in EndpointName]: RequestOf<(typeof endpoints)[K]> };
export type Responses = { readonly [K in EndpointName]: ResponseOf<(typeof endpoints)[K]> };
describe("boundary contracts", () => {
  test("rejects malformed primitives when external input crosses the boundary", () => {
    // Given: malformed identities, time, digests and object names.
    const malformed = [
      [IdSchema, "not-an-id"], [InstantSchema, "2026-10-26"], [DigestSchema, "AA".repeat(32)],
      [GitOidSchema, "sha1:wrong"],
    ] as const;
    // When: they are parsed.
    const results = malformed.map(([schema, value]) => schema.safeParse(value).success);
    // Then: none enters the domain.
    expect(results).toEqual([false, false, false, false]);
  });
  test.each(["/etc/passwd", "../main.tex", "a/../main.tex", ".git/config", "a//b", "a\\b", "a/\0b"])(
    "rejects path %s when a project path is parsed", (value) => {
      // Given: an unsafe project path.
      // When: it is parsed.
      const result = ProjectPathSchema.safeParse(value);
      // Then: it is rejected.
      expect(result.success).toBe(false);
    },
  );
  test("accepts Unicode paths when they are normalized relative paths", () => {
    // Given: a normalized non-BMP file name.
    const input = "sections/研究-😀.tex";
    // When: it is parsed.
    const path = ProjectPathSchema.parse(input);
    // Then: bytes of its name are preserved.
    expect(path).toBe(input);
  });
  test("rejects server-owned fields when a project mutation is parsed", () => {
    // Given: a client attempting to control ownership.
    const input = { params: {}, query: {}, body: { name: "Paper", origin: { kind: "blank" }, ownerId: ids.outsider } };
    // When: the shared mutation schema parses the request.
    const result = endpoints.projectCreate.input.safeParse(input);
    // Then: the ownership injection is rejected.
    expect(result.success).toBe(false);
  });
  test("requires optimistic version when preferences change", () => {
    // Given: an otherwise valid preference change.
    const request = { params: {}, query: {}, body: { theme: "dark" } };
    // When: it lacks the concurrency version.
    const result = endpoints.preferencesPatch.input.safeParse(request);
    // Then: it cannot enter the mutation handler.
    expect(result.success).toBe(false);
  });
  test("rejects invalid realtime bytes when an update is parsed", () => {
    // Given: a syntactically malformed encoded update.
    const update = { type: "update", fileId: ids.mainFile, epoch: 0, clientId: ids.mai, clientSeq: 1, updateBase64: "<invalid>" };
    // When: the protocol schema parses it.
    const result = RealtimeClientMessageSchema.safeParse(update);
    // Then: it is rejected before a Yjs document can receive it.
    expect(result.success).toBe(false);
  });
  test("rejects malformed anchors when a suggestion crosses the mutation boundary", () => {
    // Given: an edit whose relative anchor cannot be decoded as base64.
    const input = { params: { p: ids.project }, query: {}, body: {
      scope: { projectId: ids.project, branch: "main" }, expectedVersion: 0,
      edits: [{ fileId: ids.mainFile, anchor: { fileId: ids.mainFile, epoch: 0,
        startRelative: "<invalid>", endRelative: "AA==", quote: "before" },
        before: "before", after: "after", baseRevision: 0 }],
    } };
    // When: the shared suggestion request parses it.
    const result = endpoints.suggestionCreate.input.safeParse(input);
    // Then: a handler never receives the malformed position.
    expect(result.success).toBe(false);
  });
  test("has unambiguous route dispatch when the registry is composed", () => {
    // Given: all registered endpoint definitions.
    const routes = endpointRegistry.map((route) => `${route.method} ${route.path}`);
    // When: dispatch keys are compared.
    const unique = new Set(routes);
    // Then: no endpoint shadows another exact method/path contract.
    expect(unique.size).toBe(routes.length);
    expect(endpointRegistry.every((route) => route.input instanceof z.ZodType && route.output instanceof z.ZodType)).toBe(true);
  });
  test("keeps nullable fields explicit when a user response is parsed", () => {
    // Given: a DTO with a missing field whose absence should be null.
    const user = { id: ids.kien, name: "Kien", primaryEmail: "kien@quire.local", verifiedEmails: [], avatarBlob: null, latexName: "", affiliation: "", orcid: null, interfaceLanguage: "en" };
    // When: the response is parsed.
    const result = UserSchema.safeParse(user);
    // Then: omission is not mistaken for an explicit absent value.
    expect(result.success).toBe(false);
  });
  test("admits compile requests only with a nonnegative pinned revision", () => {
    // Given: an invalid snapshot revision.
    const request = { scope: { projectId: ids.project, branch: "main" }, expectedRevision: -1, clean: false };
    // When: the request boundary parses it.
    const result = CompileRequestSchema.safeParse(request);
    // Then: the invalid revision cannot enqueue work.
    expect(result.success).toBe(false);
  });
  test("keeps initial policy and preferences locally usable when fixtures load", () => {
    // Given: the parsed fixture configuration.
    // When: the defaults are selected.
    const defaults = [defaultPreferences.autoCompile, defaultPolicy.ai, defaultPolicy.historyDays];
    // Then: no compile/provider invocation or history expiry is silently enabled.
    expect(defaults).toEqual([false, "off", null]);
  });
});
