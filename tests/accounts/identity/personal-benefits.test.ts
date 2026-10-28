import { expect, test } from "bun:test";
import { z } from "zod";
import { FileEntrySchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { resetWritableSelection } from "../../../services/accounts/identity/project-benefits";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { dropboxServer } from "../../adapters/dropbox/provider";
import { dropboxFixture } from "../../adapters/dropbox/harness";
import { referencesFixture } from "../../adapters/references/harness";
import { referenceProvider } from "../../adapters/references/provider";
import { aiFixture, errorSchema } from "../../adapters/ai/harness";
import { providerServer } from "../../adapters/ai/provider";

async function ownerGrant(context: ModuleContext, ownerId: Id) {
  await context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.run("UPDATE account_project_benefits SET benefits_json=? WHERE scope_kind='deployment'",
      [JSON.stringify({ compileSeconds: 12, writableMembers: 3, historyDays: 1, trackChanges: false })]);
    await tx.run(`INSERT INTO account_project_benefits(scope_kind,scope_id,benefits_json,version,updated_at)
      VALUES('user',?,?,1,?)`, [ownerId, JSON.stringify({ compileSeconds: 90, writableMembers: 3,
      historyDays: null, trackChanges: true }), context.clock.now()]);
  });
}
test("owner project benefits never grant another actor's Dropbox credentials or bypass Dropbox policy", async () => {
  // Given: real OAuth-owned credentials and a stronger owner project grant.
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  const { fixture, owner, grant } = harness;
  const editor = await fixture.login("mai@quire.local");
  const stored = await fixture.runtime.db.get("SELECT owner_id,encrypted_secret,version FROM provider_grants WHERE id=?", [grant.id]);
  await ownerGrant(fixture.service.context, owner.user.id);
  const deniedPolicy = await fixture.request(`/api/dropbox/policies/project/${ids.project}`, {
    method: "PUT", headers: owner.headers, body: JSON.stringify({ enabled: false, expectedVersion: 0 }),
  });
  expect(deniedPolicy.status).toBe(200);
  const calls = provider.observed.length;
  // When: a collaborator attempts the owner's connection and its owner attempts a policy-denied sync.
  const foreign = await fixture.request(`/api/connections/${grant.id}/actions`, {
    method: "POST", headers: { ...editor.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ action: "initialSync", projectId: ids.project, parameters: {}, expectedCursor: null, expectedVersion: grant.version }),
  });
  const own = await harness.action("initialSync");
  // Then: benefit projection neither transfers personal ownership nor replaces connector denial.
  expect(foreign.status).toBe(404);
  expect(own.status).toBe(403);
  expect(provider.observed).toHaveLength(calls);
  expect(await fixture.runtime.db.get("SELECT owner_id,encrypted_secret,version FROM provider_grants WHERE id=?", [grant.id])).toEqual(stored);
});
test("reference bytes remain citable after transfer without transferring the original owner's refresh grant", async () => {
  // Given: actual imported bibliography bytes and a separately owned provider credential.
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin, { links: true });
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const recipient = await fixture.login("mai@quire.local");
  const grant = await fixture.connect(owner);
  const scope = { projectId: ids.project, branch: "main" };
  const created = await fixture.request(`/api/projects/${ids.project}/links`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, kind: "bibliography", path: "retained-reference.bib", grantId: grant.id,
      url: `${provider.origin}/users/123/items`, expectedVersion: 0 }),
  });
  expect(created.status).toBe(200);
  const file = z.object({ data: FileEntrySchema }).parse(await created.json()).data;
  if (!file.blob) throw new TypeError("Real reference bytes required");
  const bytes = await fixture.runtime.blobs.get(file.blob);
  await ownerGrant(fixture.service.context, owner.user.id);
  // The ordinary transfer endpoint is tested separately; this is its committed account state.
  await fixture.runtime.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.run("DELETE FROM project_members WHERE project_id=? AND user_id=?", [ids.project, recipient.user.id]);
    await tx.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'editor',?)",
      [crypto.randomUUID(), ids.project, owner.user.id, fixture.runtime.clock.now()]);
    await tx.run("UPDATE projects SET owner_id=?,version=version+1 WHERE id=?", [recipient.user.id, ids.project]);
    await resetWritableSelection({ ...fixture.service.context, db: tx }, ids.project);
  });
  const requests = provider.state.requests.length;
  // When: the current owner tries to refresh using the prior owner's credential.
  const response = await fixture.request(`/api/projects/${ids.project}/links/${file.id}/refresh`, {
    method: "POST", headers: { ...recipient.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedDigest: file.blob, expectedVersion: (await fixture.service.getBranch(scope)).revision }),
  });
  // Then: ownership stays personal while imported project bytes remain unchanged.
  expect(response.status).toBe(404);
  expect(errorSchema.parse(await response.json()).error.code).toBe("NOT_FOUND");
  expect(await fixture.runtime.db.get("SELECT owner_id FROM provider_grants WHERE id=?", [grant.id]))
    .toEqual({ owner_id: owner.user.id });
  expect(provider.state.requests).toHaveLength(requests);
  expect((await fixture.service.getFile(scope, file.id)).blob).toBe(file.blob);
  expect(Array.from(await fixture.runtime.blobs.get(file.blob))).toEqual(Array.from(bytes));
});
test("charges the acting AI account and preserves its exhausted allowance across owner benefit changes", async () => {
  // Given: real inference charged to an Editor rather than the project owner.
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  await fixture.configure(1);
  const owner = await fixture.login();
  const actor = await fixture.login("mai@quire.local");
  const project = await fixture.project(owner);
  await fixture.project(actor);
  await fixture.runtime.db.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'editor',?)",
    [crypto.randomUUID(), project.id, actor.user.id, fixture.clock.now()]);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  expect((await fixture.run(actor, { scope, mode: "ask", tool: "chat", prompt: "First request", fileIds: [] })).status).toBe("succeeded");
  const ledger = await fixture.runtime.db.all("SELECT * FROM ai_usage ORDER BY id");
  await ownerGrant(fixture.core.context, owner.user.id);
  // When: the same actor requests another inference after project benefits increase.
  const response = await fixture.request(`/api/projects/${project.id}/ai/runs`, {
    method: "POST", headers: { ...actor.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, mode: "ask", tool: "chat", prompt: "No extra allowance", fileIds: [] }),
  });
  // Then: no benefit or owner account pays for or restores that actor's exhausted allowance.
  expect(response.status).toBe(429);
  expect(provider.received).toHaveLength(1);
  expect(await fixture.runtime.db.all("SELECT * FROM ai_usage ORDER BY id")).toEqual(ledger);
  expect((await fixture.ai.store.usage(actor.actor, "2026-10")).used).toBe(1);
  expect((await fixture.ai.store.usage(owner.actor, "2026-10")).used).toBe(0);
});
