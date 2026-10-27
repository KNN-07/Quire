import { expect, test } from "bun:test";
import { catalogFixture, templateEnvelope, projectEnvelope } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";

for (const submitted of [false, true]) {
  test(`denies an author's unapproved ${submitted ? "submitted" : "draft"} template copy`, async () => {
    // Given: a real author's source snapshot without curator approval.
    await using app = await catalogFixture();
    const author = await app.login();
    let version = templateEnvelope.parse(await (await app.mutate("/api/templates", author.headers, {
      name: "Review required", category: "", description: "", license: "MIT",
      visibility: "private", sourceProjectId: fixtureIds.project,
    })).json()).data;
    if (submitted) version = templateEnvelope.parse(await (await app.mutate(`/api/templates/${version.templateId}/submit`,
      author.headers, { expectedVersion: version.version })).json()).data;
    // When: authorship is used to bypass template approval.
    const response = await app.mutate("/api/projects", author.headers, {
      name: "Unapproved copy", origin: { kind: "template", templateVersionId: version.id },
    });
    // Then: creation from an unapproved template is rejected even for its author.
    expect(response.status).toBe(404);
  });
}

test("allows the author to copy an approved private version without public publication", async () => {
  // Given: a private version that has actually passed submission and approval.
  await using app = await catalogFixture();
  const author = await app.login();
  const operator = await app.login("operator@quire.local");
  let version = templateEnvelope.parse(await (await app.mutate("/api/templates", author.headers, {
    name: "Approved private", category: "", description: "", license: "MIT",
    visibility: "private", sourceProjectId: fixtureIds.project,
  })).json()).data;
  version = templateEnvelope.parse(await (await app.mutate(`/api/templates/${version.templateId}/submit`,
    author.headers, { expectedVersion: version.version })).json()).data;
  version = templateEnvelope.parse(await (await app.mutate(`/api/templates/${version.templateId}/approve`,
    operator.headers, { expectedVersion: version.version, versionId: version.id })).json()).data;
  // When: the author creates an independent project from that approved version.
  const response = await app.mutate("/api/projects", author.headers, {
    name: "Approved copy", origin: { kind: "template", templateVersionId: version.id },
  });
  // Then: approval permits the copy while private visibility remains intact.
  expect(response.status).toBe(200);
  expect(projectEnvelope.parse(await response.json()).data.ownerId).toBe(author.user.id);
});
