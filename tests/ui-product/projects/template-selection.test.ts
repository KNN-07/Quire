import { expect, test } from "bun:test";
import { createClient, TemplateVersionSchema } from "@quire/contracts";
import { loadTemplates } from "../../../apps/web/src/features/projects/api";
import { fixtureIds } from "../../fixtures/foundation";

test("offers only approved source versions after reading every template page", async () => {
  // Given: an author's mixed lifecycle states spread across actual HTTP pages.
  const templates = ["draft", "submitted", "approved", "published", "unpublished"].map(status =>
    TemplateVersionSchema.parse({ id: crypto.randomUUID(), templateId: crypto.randomUUID(),
      snapshotId: fixtureIds.snapshot, name: status, category: "", description: "", license: "MIT",
      visibility: "private", organizationId: null, version: 4, status }));
  let pagesRead = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    pagesRead += 1;
    const second = new URL(request.url).searchParams.has("cursor");
    return Response.json({ requestId: fixtureIds.operator, data: {
      items: second ? templates.slice(2) : templates.slice(0, 2), nextCursor: second ? null : "next-page",
    } });
  } });
  try {
    // When: the actual typed loader prepares copy choices.
    const choices = await loadTemplates(createClient(server.url.origin), AbortSignal.timeout(5000));
    // Then: pagination does not leak unapproved or withdrawn choices into the picker.
    expect(pagesRead).toBe(2);
    expect(choices.map(item => item.status)).toEqual(["approved", "published"]);
  } finally { await server.stop(true); }
});
