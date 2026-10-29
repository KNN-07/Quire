import { expect, test } from "bun:test";
import { z } from "zod";
import { DigestSchema, FileEntrySchema, OperationSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { referencesFixture } from "./harness";
import { mendeleyGroupId, mendeleyGroupProvider } from "./mendeley-provider";

const fileEnvelope = z.object({ data: FileEntrySchema });
const operationEnvelope = z.object({ data: OperationSchema });
const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });
const scope = { projectId: fixtureIds.project, branch: "main" };

test("Mendeley lists authorized paginated V2 groups and persists personal versus selected group through restart and refresh", async () => {
  await using provider = mendeleyGroupProvider();
  await using fixture = await referencesFixture(provider.origin, { links: true });
  await fixture.configure("mendeley");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner, "mendeley");
  const listed = await fixture.action(owner, grant, { action: "groups", projectId: scope.projectId, parameters: {} });
  expect(listed.status).toBe(202);
  const listing = operationEnvelope.parse(await listed.json()).data;
  expect(listing.status).toBe("succeeded");
  expect(z.object({ groups: z.array(z.object({ id: z.string() })) }).parse(listing.result).groups.map(group => group.id))
    .toContain(mendeleyGroupId);
  expect(provider.state.requests.filter(item => item.path.startsWith("/groups/v2?"))).toHaveLength(2);
  async function create(path: string, url?: string) {
    const response = await fixture.request(`/api/projects/${scope.projectId}/links`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ scope, path, kind: "bibliography", grantId: grant.id, url,
        expectedVersion: (await fixture.service.getBranch(scope)).revision }) });
    expect(response.status).toBe(200);
    return fileEnvelope.parse(await response.json()).data;
  }
  const personal = await create("personal.bib");
  const group = await create("group.bib", `${provider.origin}/groups/v2/${mendeleyGroupId}`);
  if (!personal.blob || !group.blob) throw new TypeError("Linked blobs required");
  const personalBytes = new TextDecoder().decode(await fixture.runtime.blobs.get(personal.blob));
  const groupBytes = new TextDecoder().decode(await fixture.runtime.blobs.get(group.blob));
  expect(personalBytes).toContain("Personal account paper");
  expect(personalBytes).not.toContain("Group topology");
  expect(groupBytes).toContain("Group topology paper");
  expect(groupBytes).toContain("Group topology paper supplement");
  expect(groupBytes).not.toContain("Personal account");
  expect(group.editable).toBe(false);
  const selection = JSON.stringify({ provider: "mendeley", libraryType: "groups", groupId: mendeleyGroupId });
  expect(await fixture.runtime.db.get("SELECT selection_json FROM reference_links WHERE file_id=?", [group.id]))
    .toEqual({ selection_json: selection });
  expect(await fixture.runtime.db.get("SELECT selection_json FROM reference_links WHERE file_id=?", [personal.id]))
    .toEqual({ selection_json: JSON.stringify({ provider: "mendeley", libraryType: "personal" }) });
  await fixture.restart();
  provider.state.groupTitle = "Changed group source";
  const refreshed = await fixture.request(`/api/projects/${scope.projectId}/links/${group.id}/refresh`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedDigest: group.blob, expectedVersion: (await fixture.service.getBranch(scope)).revision }) });
  expect(refreshed.status).toBe(200);
  const updated = fileEnvelope.parse(await refreshed.json()).data;
  if (!updated.blob) throw new TypeError("Refreshed blob required");
  expect(new TextDecoder().decode(await fixture.runtime.blobs.get(updated.blob))).toContain("Changed group source");
  expect(await fixture.runtime.db.get("SELECT selection_json,version FROM reference_links WHERE file_id=?", [group.id]))
    .toEqual({ selection_json: selection, version: 2 });
  expect(provider.state.requests.filter(item => item.path.startsWith("/documents?") && item.path.includes("marker="))
    .every(item => new URL(item.path, provider.origin).searchParams.get("group_id") === mendeleyGroupId)).toBe(true);
  await fixture.runtime.repositories.assertReadable(scope.projectId);
});

test("Mendeley group failures, removed groups, foreign origins, Viewer and changed authority retain the original source", async () => {
  await using provider = mendeleyGroupProvider();
  await using fixture = await referencesFixture(provider.origin, { links: true });
  await fixture.configure("mendeley");
  const owner = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  const grant = await fixture.connect(owner, "mendeley");
  const viewerGrant = await fixture.connect(viewer, "mendeley");
  const create = async (actor = owner, grantId = grant.id, url = `${provider.origin}/groups/v2/${mendeleyGroupId}`) =>
    fixture.request(`/api/projects/${scope.projectId}/links`, { method: "POST",
      headers: { ...actor.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ scope, path: "group.bib", kind: "bibliography", grantId, url,
        expectedVersion: (await fixture.service.getBranch(scope)).revision }) });
  const denied = await create(viewer, viewerGrant.id);
  expect(denied.status).toBe(403);
  const calls = provider.state.requests.length;
  expect((await create(owner, grant.id, `https://foreign.invalid/groups/v2/${mendeleyGroupId}`)).status).toBe(400);
  expect(provider.state.requests).toHaveLength(calls);
  const created = await create();
  expect(created.status).toBe(200);
  const file = fileEnvelope.parse(await created.json()).data;
  const original = await fixture.service.listFiles(scope);
  const refresh = async () => fixture.request(`/api/projects/${scope.projectId}/links/${file.id}/refresh`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedDigest: file.blob, expectedVersion: (await fixture.service.getBranch(scope)).revision }) });
  for (const status of [403, 404]) {
    provider.state.groupStatus = status;
    const response = await refresh();
    expect(errorEnvelope.parse(await response.json()).error.code).toBe(status === 403 ? "PROVIDER_ACCESS_DENIED" : "PUBLICATION_NOT_FOUND");
    expect(await fixture.service.listFiles(scope)).toEqual(original);
  }
  provider.state.groupStatus = 200;
  provider.state.escapeDocuments = true;
  expect(errorEnvelope.parse(await (await refresh()).json()).error.code).toBe("PROVIDER_PAGING_INVALID");
  provider.state.escapeDocuments = false;
  provider.state.onRequest = () => fixture.runtime.uow.run(async tx => {
    await tx.run("UPDATE adapter_provider_configs SET version=version+1 WHERE kind='mendeley'");
  });
  expect(errorEnvelope.parse(await (await refresh()).json()).error.code).toBe("PROVIDER_CHANGED");
  provider.state.onRequest = () => fixture.runtime.uow.run(async tx => {
    await tx.run("UPDATE provider_grants SET version=version+1 WHERE id=?", [grant.id]);
  });
  expect((await refresh()).status).toBe(409);
  await fixture.runtime.uow.run(async tx => {
    await tx.run("UPDATE provider_grants SET state='disabled',encrypted_secret=NULL,version=version+1 WHERE id=?", [grant.id]);
  });
  expect(errorEnvelope.parse(await (await refresh()).json()).error.code).toBe("GRANT_UNAVAILABLE");
  expect(await fixture.service.listFiles(scope)).toEqual(original);
  expect(await fixture.runtime.db.all("SELECT id FROM base_source_intents")).toEqual([]);
});

test("Mendeley bulk action retains typed group identity and refresh reads that identity rather than the account default", async () => {
  await using provider = mendeleyGroupProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("mendeley");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner, "mendeley");
  const selection = { provider: "mendeley", libraryType: "groups", groupId: mendeleyGroupId };
  const created = await fixture.action(owner, grant, { action: "bulkBib", projectId: scope.projectId,
    parameters: { scope, path: "bulk-group.bib", selection } });
  expect(created.status).toBe(202);
  const result = z.object({ linkId: z.string(), fileId: z.string(), digest: z.string(), version: z.number() })
    .parse(operationEnvelope.parse(await created.json()).data.result);
  provider.state.groupTitle = "Bulk refreshed group";
  const refreshed = await fixture.action(owner, grant, { action: "refresh", projectId: scope.projectId,
    parameters: { linkId: result.linkId, expectedDigest: result.digest, expectedVersion: result.version } });
  expect(refreshed.status).toBe(202);
  const next = z.object({ digest: DigestSchema }).parse(operationEnvelope.parse(await refreshed.json()).data.result);
  expect(await fixture.runtime.db.get("SELECT selection_json,version FROM reference_links WHERE id=?", [result.linkId]))
    .toEqual({ selection_json: JSON.stringify(selection), version: 2 });
  const file = (await fixture.service.listFiles(scope)).find(item => item.id === result.fileId);
  if (!file?.blob) throw new TypeError("Actual bulk-linked bibliography required");
  expect(file.blob).toBe(next.digest);
  expect(file.editable).toBe(false);
  expect(new TextDecoder().decode(await fixture.runtime.blobs.get(file.blob))).toContain("Bulk refreshed group");
});

test("Mendeley group listing rejects repeated pages, forbidden listing and cross-origin pagination", async () => {
  await using provider = mendeleyGroupProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("mendeley");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner, "mendeley");
  const list = () => fixture.action(owner, grant, { action: "groups", projectId: scope.projectId, parameters: {} });
  provider.state.repeatGroups = true;
  expect(errorEnvelope.parse(await (await list()).json()).error.code).toBe("PROVIDER_PAGING_INVALID");
  provider.state.repeatGroups = false;
  provider.state.escapeGroups = true;
  expect(errorEnvelope.parse(await (await list()).json()).error.code).toBe("PROVIDER_PAGING_INVALID");
  provider.state.escapeGroups = false;
  provider.state.groupsStatus = 403;
  expect(errorEnvelope.parse(await (await list()).json()).error.code).toBe("PROVIDER_ACCESS_DENIED");
});
