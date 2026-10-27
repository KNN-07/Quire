import { expect, test } from "bun:test";
import { z } from "zod";
import { TemplateVersionSchema } from "@quire/contracts";
import { catalogFixture, templateEnvelope } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";

test("lists another author's submitted version for an operator without publishing it", async () => {
  // Given: a submitted template that the public gallery cannot reveal.
  await using fixture = await catalogFixture();
  const author = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  const created = templateEnvelope.parse(await (await fixture.mutate("/api/templates", author.headers, {
    name: "Awaiting review", category: "Article", description: "", license: "MIT",
    visibility: "public", sourceProjectId: fixtureIds.project,
  })).json()).data;
  const submitted = templateEnvelope.parse(await (await fixture.mutate(`/api/templates/${created.templateId}/submit`,
    author.headers, { expectedVersion: created.version })).json()).data;
  // When: the operator opens the administration queue.
  const response = await fixture.request("/api/admin/templates", { headers: operator.headers });
  // Then: the queue exposes the exact version and guard, without broadening gallery visibility.
  expect(response.status).toBe(200);
  const page = z.object({ data: z.object({ items: z.array(TemplateVersionSchema) }) }).parse(await response.json()).data;
  expect(page.items).toContainEqual(submitted);
  expect((await fixture.request(`/api/templates/${created.templateId}`)).status).toBe(404);
});

test("denies template administration discovery to an ordinary authenticated user", async () => {
  // Given: a valid account without operator privilege.
  await using fixture = await catalogFixture();
  const outsider = await fixture.login("outsider@quire.local");
  // When: it requests the private administration queue.
  const response = await fixture.request("/api/admin/templates", { headers: outsider.headers });
  // Then: knowing the route does not reveal submissions.
  expect(response.status).toBe(403);
});
