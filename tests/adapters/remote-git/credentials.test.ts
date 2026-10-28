import { expect, test } from "bun:test";
import { z } from "zod";
import { AdapterGrantSchema, IdSchema } from "@quire/contracts";
import { RemoteRepository } from "../../../services/adapters/remote-git";
import { githubFixture } from "./provider-fixture";
import { remoteGitHarness } from "./harness";
import { action, operation } from "./test-helpers";

test("generic Git credentials are verified, repository-bound, encrypted and locally removable", async () => {
  // Given: a real authenticated Git HTTP repository and a configured generic provider.
  await using provider = await githubFixture();
  await using app = await remoteGitHarness(provider.origin, { interchange: true });
  await app.configure(); await app.configure("git");
  const owner = await app.login();
  await app.connect(owner);
  const secret = provider.tokens[0];
  if (!secret) throw new TypeError("Expected real fixture Git credential");
  const url = `${provider.origin}/owner/research.git`;
  const body = JSON.stringify({ label: "Bound repository", url, username: "git", secret });
  expect((await app.request("/api/connections/git/credentials", { method: "POST", body })).status).toBe(401);
  expect((await app.request("/api/connections/git/credentials", {
    method: "POST", headers: { cookie: owner.headers.cookie }, body,
  })).status).toBe(403);
  // When: the verified credential is saved and used for an actual clone.
  const response = await app.request("/api/connections/git/credentials", { method: "POST", headers: owner.headers, body });
  expect(response.status).toBe(200);
  const raw = await response.text();
  const grant = z.object({ data: AdapterGrantSchema }).parse(JSON.parse(raw)).data;
  expect(raw.includes(secret)).toBe(false);
  const imported = await action({ app, session: owner, grantId: grant.id, grantVersion: grant.version,
    name: "clone", parameters: { name: "Generic clone", url, branch: "main" } });
  expect(imported.status, await imported.clone().text()).toBe(202);
  const result = z.object({ projectId: IdSchema }).parse((await operation(imported)).result);
  await app.restart();
  // Then: durable source is real, another repository cannot receive the credential,
  // and local deletion forgets the saved secret without claiming provider revocation.
  const project = await app.projects.getProject(result.projectId);
  expect((await app.projects.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId)).text)
    .toContain("Remote initial");
  const cursor = await app.runtime.db.get<{ cursor: string | null }>(
    "SELECT cursor FROM adapter_cursors WHERE grant_id=? AND action='clone'", [grant.id]);
  if (!cursor) throw new TypeError("Expected durable clone cursor");
  const wrongRepository = await action({ app, session: owner, grantId: grant.id, grantVersion: grant.version,
    name: "clone", expectedCursor: cursor.cursor,
    parameters: { name: "Denied", url: `${provider.origin}/other/repo.git`, branch: "main" } });
  expect(wrongRepository.status, await wrongRepository.clone().text()).toBe(403);
  const tested = await app.request(`/api/connections/${grant.id}/test`, {
    method: "POST", headers: owner.headers, body: JSON.stringify({ expectedVersion: grant.version }),
  });
  expect(tested.status).toBe(200);
  const deleted = await app.request(`/api/connections/${grant.id}`, {
    method: "DELETE", headers: owner.headers, body: JSON.stringify({ expectedVersion: grant.version }),
  });
  expect(deleted.status).toBe(200);
  expect(await app.runtime.db.get("SELECT encrypted_secret,state FROM provider_grants WHERE id=?", [grant.id]))
    .toMatchObject({ encrypted_secret: null, state: "disabled" });
  await using remote = await RemoteRepository.open({ url, credentials: { username: "git", password: secret },
    options: { fixtureOrigins: [provider.origin] } });
  expect((await remote.branches()).has("main")).toBe(true);
}, 60000);
