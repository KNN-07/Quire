import { expect, test } from "bun:test";
import { z } from "zod";
import { baseFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("searches editable project text and reports excluded binary files through HTTP", async () => {
  // Given: a source project containing editable Unicode and an ordinary binary asset.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const project = await fixture.service.createFromFiles(owner.user.id, { name: "Search fixture", entries: [
    { path: "main.tex", bytes: new TextEncoder().encode("\\documentclass{article}\nHello 😀\nHELLO friend\n") },
    { path: "asset.bin", bytes: new Uint8Array([0, 255, 1]) },
  ] });
  // When: the client performs a case-insensitive whole-word source search.
  const response = await fixture.request(`/api/projects/${project.id}/search?branch=main&q=hello&word=true`, { headers: owner.headers });
  // Then: both text matches have exact positions and the binary exclusion is explicit.
  const result = z.object({ data: z.object({
    matches: z.array(z.object({ line: z.number(), column: z.number() })),
    excluded: z.array(z.object({ fileId: z.string(), reason: z.string() })),
  }) }).parse(await response.json()).data;
  expect(result.matches).toEqual([{ line: 2, column: 1 }, { line: 3, column: 1 }]);
  expect(result.excluded).toHaveLength(1);
});

test("rejects an invalid regular expression without running project search", async () => {
  // Given: a source project with an authenticated owner.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  // When: the client submits a syntactically invalid expression.
  const response = await fixture.request(`/api/projects/${ids.project}/search?branch=main&q=%5B&regex=true`, { headers: owner.headers });
  // Then: a checked client error, not a server exception, is returned.
  expect(response.status).toBe(400);
});
