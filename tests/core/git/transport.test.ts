import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../../../services/core/git/process";
import { gitFixture } from "./harness";

test("T11 named transport bundle restores a separate repository without private checkpoints", async () => {
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const bundle = await fixture.runtime.repositories.exportNamed(project.id);
  const bundlePath = join(fixture.path, "named.bundle");
  const path = join(fixture.path, "public.git");
  await writeFile(bundlePath, bundle);
  await run({ path, args: ["init", "--bare", "--initial-branch=main", path] });
  await run({ path, args: ["fetch", "--no-tags", "--no-write-fetch-head", bundlePath, "+refs/heads/*:refs/heads/*"] });
  const names = await run({ path, args: ["for-each-ref", "--format=%(refname) %(objectname)"] });
  expect(names.text).toBe(`refs/heads/main ${before.head.replace("sha1:", "")}`);
  expect((await run({ path, args: ["show", "main:main.tex"] })).text).toContain("\\documentclass");
  const hidden = await run({ path: join(fixture.path, "git", `${project.id}.git`),
    args: ["for-each-ref", "--format=%(objectname)", "refs/quire/history/"] });
  const checkpoint = hidden.text.split("\n")[0];
  if (!checkpoint) throw new TypeError("Expected actual private checkpoint");
  expect((await run({ path, args: ["cat-file", "-e", checkpoint], allowed: [0, 1, 128] })).code).not.toBe(0);
  const cgi = await run({ path, args: ["-c", "http.receivepack=true",
    "-c", "transfer.hideRefs=refs/quire/", "-c", "receive.hideRefs=refs/quire/",
    "-c", "uploadpack.allowAnySHA1InWant=false", "-c", "uploadpack.allowReachableSHA1InWant=false",
    "-c", "receive.fsckObjects=true", "-c", "uploadpack.allowFilter=false", "http-backend"],
    env: { GIT_PROJECT_ROOT: fixture.path, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: "/public.git/info/refs",
      REQUEST_METHOD: "GET", QUERY_STRING: "service=git-upload-pack", REMOTE_USER: owner.user.id,
      CONTENT_TYPE: "", CONTENT_LENGTH: "0", HTTP_GIT_PROTOCOL: "" } });
  expect(cgi.text).toContain("refs/heads/main");
  const token = await fixture.token(owner.headers);
  const advertised = await fixture.request(`/git/${project.id}.git/info/refs?service=git-upload-pack`,
    { headers: { authorization: `Bearer ${token.secretOnce}` } });
  const body = await advertised.text();
  expect(advertised.status, body).toBe(200);
  expect(body).toContain("refs/heads/main");
  const url = new URL(`/git/${project.id}.git`, fixture.server.url);
  url.username = "git";
  url.password = token.secretOnce;
  const checkout = join(fixture.path, "checkout");
  await run({ args: ["clone", url.toString(), checkout] });
  await run({ args: ["-C", checkout, "fetch", "origin"] });
  expect((await run({ args: ["-C", checkout, "rev-parse", "HEAD"] })).text).toBe(before.head.replace("sha1:", ""));
});

test("T11 a current Viewer can initialize named read history but cannot mutate it", async () => {
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  const project = await fixture.create(owner.headers);
  await fixture.runtime.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'viewer',?)",
      [crypto.randomUUID(), project.id, viewer.user.id, fixture.runtime.clock.now()]);
  });
  const token = await fixture.token(viewer.headers);
  const advertised = await fixture.request(`/git/${project.id}.git/info/refs?service=git-upload-pack`,
    { headers: { authorization: `Bearer ${token.secretOnce}` } });
  expect(advertised.status, await advertised.clone().text()).toBe(200);
  expect(await advertised.text()).toContain("refs/heads/main");
  const status = await fixture.status(viewer.headers, project.id);
  const denied = await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
    headers: { ...viewer.headers, "if-match": `"v${status.revision}"` },
    body: JSON.stringify({ scope: { projectId: project.id, branch: "main" }, head: status.head,
      hunkIds: [], staged: true, expectedVersion: status.revision }) });
  expect(denied.status).toBe(403);
});
