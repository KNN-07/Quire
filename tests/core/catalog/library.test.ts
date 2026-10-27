import { test, expect } from "bun:test";
import { catalogFixture, bib, publication, entryEnvelope, fileEnvelope, errorEnvelope } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("rejects account access when another actor requests a Library record", async () => {
  // Given: one account's manual Library entry.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const outsider = await fixture.login("outsider@quire.local");
  const entry = entryEnvelope.parse(await (await fixture.mutate("/api/me/library", owner.headers, { bibtex: bib, origin: "manual" })).json()).data;
  // When: another actor reads its ID.
  const result = await fixture.request(`/api/me/library/${entry.id}`, { headers: outsider.headers });
  // Then: the entry is not disclosed.
  expect(result.status).toBe(404);
});

for (const method of ["PATCH", "DELETE"]) {
  test(`rejects ${method} when a Library entry is read-only linked data`, async () => {
    // Given: a persisted provider-linked record.
    await using fixture = await catalogFixture();
    const owner = await fixture.login();
    const entry = entryEnvelope.parse(await (await fixture.mutate("/api/me/library", owner.headers, { bibtex: bib, origin: "provider" })).json()).data;
    fixture.runtime.db.query("UPDATE library_entries SET readonly=1 WHERE id=?").run(entry.id);
    // When: the owner attempts a local mutation.
    const result = await fixture.request(`/api/me/library/${entry.id}`, { method, headers: owner.headers, body: JSON.stringify({ expectedVersion: 0 }) });
    // Then: linked data rejects mutation rather than silently breaking synchronization.
    expect(result.status).toBe(403);
    expect(errorEnvelope.parse(await result.json()).error.code).toBe("READ_ONLY_BIBLIOGRAPHY");
  });
}

for (const [email, expected] of [["kien@quire.local", 200], ["mai@quire.local", 200], ["sam@quire.local", 403], ["alex@quire.local", 403]] as const) {
  test(`enforces source role when ${email} inserts a citation`, async () => {
    // Given: real seeded Owner, Editor, Reviewer and Viewer memberships.
    await using fixture = await catalogFixture();
    const actor = await fixture.login(email);
    const scope = { projectId: ids.project, branch: "main" };
    // When: a citation is copied into the seeded bibliography.
    const result = await fixture.mutate(`/api/projects/${ids.project}/citations`, actor.headers,
      { scope, publication, command: "citep", expectedVersion: fixture.service.getBranch(scope).revision });
    // Then: only writable source roles can mutate it.
    expect(result.status).toBe(expected);
  });
}

test("requires a target when several editable bibliography files exist", async () => {
  // Given: a real project with two editable bibliography files.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  for (const path of ["one.bib", "two.bib"]) {
    await fixture.mutate(`/api/projects/${project.id}/files`, owner.headers,
      { scope, path, kind: "file", text: "", expectedVersion: fixture.service.getBranch(scope).revision });
  }
  // When: no bibliography target is selected.
  const result = await fixture.mutate(`/api/projects/${project.id}/citations`, owner.headers,
    { scope, publication, command: "citet", expectedVersion: fixture.service.getBranch(scope).revision });
  // Then: the user must choose rather than writing to an arbitrary file.
  expect(result.status).toBe(409);
  expect(errorEnvelope.parse(await result.json()).error.code).toBe("TARGET_REQUIRED");
});

test("rejects citation insertion when its explicit bibliography target is linked", async () => {
  // Given: an actual file marked as a read-only linked bibliography.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const created = await fixture.mutate(`/api/projects/${project.id}/files`, owner.headers,
    { scope, path: "linked.bib", kind: "file", text: bib, expectedVersion: fixture.service.getBranch(scope).revision });
  const file = fileEnvelope.parse(await created.json()).data;
  fixture.runtime.db.query("UPDATE files SET editable=0,link_json=? WHERE id=?").run(
    JSON.stringify({ kind: "bibliography", sourceId: "provider-collection", lastRefreshedAt: null }), file.id);
  // When: even the owner selects it for a local citation copy.
  const result = await fixture.mutate(`/api/projects/${project.id}/citations`, owner.headers,
    { scope, publication, targetFileId: file.id, command: "cite", expectedVersion: fixture.service.getBranch(scope).revision });
  // Then: local mutation is rejected.
  expect(result.status).toBe(403);
});

test("rejects a stale version when updating a Library record", async () => {
  // Given: a record updated once.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const entry = entryEnvelope.parse(await (await fixture.mutate("/api/me/library", owner.headers, { bibtex: bib, origin: "manual" })).json()).data;
  await fixture.request(`/api/me/library/${entry.id}`, { method: "PATCH", headers: owner.headers, body: JSON.stringify({ bibtex: "@book{changed,title={Changed}}", expectedVersion: 0 }) });
  // When: an older editor overwrites it.
  const response = await fixture.request(`/api/me/library/${entry.id}`, { method: "PATCH", headers: owner.headers, body: JSON.stringify({ bibtex: bib, expectedVersion: 0 }) });
  // Then: optimistic concurrency preserves the newer source.
  expect(response.status).toBe(409);
});
