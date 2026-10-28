import { test, expect } from "bun:test";
import { z } from "zod";
import { CompileJobSchema, endpoints, assertNever, createClient } from "@quire/contracts";
import { compilerHttp } from "./http-fixture";
import { fixtureIds as ids, settings, terminalEvent } from "./fixtures";
import { defaultPolicy } from "../fixtures/foundation";
import { pdfText } from "./pdf-text";

type App = Awaited<ReturnType<typeof compilerHttp>>;
const discoveryPath = `/api/projects/${ids.project}/compile-preview?branch=main`;

async function linkedPreview(app: App, role: "viewer" | "editor" = "viewer") {
  const owner = await app.login();
  const policy = { ...defaultPolicy, sharing: "anyone" as const, anonymousRead: true };
  await app.runtime.db.run("UPDATE organizations SET policy_json=?", [JSON.stringify(policy)]);
  await app.runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
    VALUES(?,'project',?,?,?)`, [crypto.randomUUID(), ids.project, JSON.stringify(policy), app.runtime.clock.now()]);
  const compiler = app.runtime.services.get("compiler");
  const job = await compiler.enqueue(ids.kien, {
    scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0,
    settings: { ...settings, stopOnFirstError: false }, clean: true,
  }, crypto.randomUUID());
  const done = terminalEvent(app.runtime, job.id);
  await app.runtime.start();
  await done;
  const successful = await compiler.get(ids.kien, job.id);
  expect(successful.status).toBe("succeeded");
  const pdf = successful.artifacts.find(artifact => artifact.name === "output.pdf");
  if (!pdf) throw new TypeError("Expected real successful PDF");
  const project = z.object({ version: z.number() }).parse(await app.runtime.db.get(
    "SELECT version FROM projects WHERE id=?", [ids.project]));
  const link = await app.request(`/api/projects/${ids.project}/link`, { method: "PUT",
    headers: { ...owner, "idempotency-key": crypto.randomUUID(), "if-match": `"v${project.version}"` },
    body: JSON.stringify({ role, expectedVersion: project.version }),
  });
  expect(link.status, await link.clone().text()).toBe(200);
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await link.json()).data.urlOnce;
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new TypeError("Expected project token");
  return { owner, token, job: successful, pdf,
    paths: [discoveryPath, `/api/compiles/${job.id}`, `/api/compiles/${job.id}/log`,
      `/api/artifacts/${pdf.id}/content`] };
}

for (const principal of ["anonymous", "signed"] as const) {
  for (const role of ["viewer", "editor"] as const) {
    test(`reads the real preview chain without enrollment when ${principal} uses a ${role} link`, async () => {
      // Given: a genuine successful PDF and a live link, without named membership.
      await using app = await compilerHttp();
      const fixture = await linkedPreview(app, role);
      const session = principal === "signed" ? await app.login("outsider@quire.local") : {};
      const headers = { ...session, "x-project-token": fixture.token };
      // When: the reader discovers and follows the job, log and actual artifact.
      const [discovery, job, log, content] = await Promise.all(fixture.paths.map(path => app.request(path, { headers })));
      if (!discovery || !job || !log || !content) throw new TypeError("Expected four read surfaces");
      // Then: all bytes are authorized read-only and GET has granted no membership.
      expect([discovery.status, job.status, log.status, content.status]).toEqual([200, 200, 200, 200]);
      const state = z.object({ data: endpoints.compilePreview.output }).parse(await discovery.json()).data;
      expect(state.job?.id).toBe(fixture.job.id);
      expect(state.preview?.artifact.id).toBe(fixture.pdf.id);
      expect(z.object({ data: CompileJobSchema }).parse(await job.json()).data.id).toBe(fixture.job.id);
      expect(await log.text()).toContain("ha2018world");
      expect(await pdfText(new Uint8Array(await content.arrayBuffer()))).toContain("Latent Dynamics");
      expect(job.headers.get("x-last-successful-artifact-id")).toBe(fixture.pdf.id);
      expect(job.headers.get("x-preview-stale")).toBe("false");
      expect(discovery.headers.get("cache-control")).toBe("private, no-store");
      expect(await app.runtime.db.get("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?",
        [ids.project, ids.outsider])).toBeNull();
      const denied = await app.request(`/api/projects/${ids.project}/compiles`, { method: "POST",
        headers: { ...headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0, settings, clean: true }),
      });
      expect(denied.status).toBe(principal === "signed" ? 404 : 401);
    }, 90000);
  }
}

for (const principal of ["anonymous", "signed"] as const) {
  for (const change of ["revoke", "sharing-policy"] as const) {
    test(`denies the entire preview chain when ${principal} Viewer access loses ${change}`, async () => {
      // Given: a valid Viewer token that currently reads the actual PDF.
      await using app = await compilerHttp();
      const fixture = await linkedPreview(app);
      const session = principal === "signed" ? await app.login("outsider@quire.local") : {};
      const headers = { ...session, "x-project-token": fixture.token };
      expect((await app.request(discoveryPath, { headers })).status).toBe(200);
      // When: the owner revokes the credential or current sharing policy disallows links.
      switch (change) {
        case "revoke": {
          const project = z.object({ version: z.number() }).parse(await app.runtime.db.get(
            "SELECT version FROM projects WHERE id=?", [ids.project]));
          const revoked = await app.request(`/api/projects/${ids.project}/link`, { method: "PUT",
            headers: { ...fixture.owner, "idempotency-key": crypto.randomUUID(), "if-match": `"v${project.version}"` },
            body: JSON.stringify({ role: "off", expectedVersion: project.version }),
          });
          expect(revoked.status).toBe(200);
          break;
        }
        case "sharing-policy":
          await app.runtime.db.run("UPDATE policy_sets SET policy_json=? WHERE scope_kind='project' AND scope_id=?",
            [JSON.stringify({ ...defaultPolicy, sharing: "named", anonymousRead: true }), ids.project]);
          break;
        default:
          assertNever(change);
      }
      // Then: every fresh request is denied, including already-known artifact/job IDs.
      const responses = await Promise.all(fixture.paths.map(path => app.request(path, { headers })));
      const status = change === "revoke" ? 404 : 403;
      expect(responses.map(response => response.status)).toEqual([status, status, status, status]);
      expect(await app.runtime.db.get("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?",
        [ids.project, ids.outsider])).toBeNull();
    }, 90000);
  }
}

test("denies anonymous preview reads when live anonymous-read policy changes", async () => {
  // Given: an anonymous Viewer token that currently authorizes discovery.
  await using app = await compilerHttp();
  const fixture = await linkedPreview(app);
  const headers = { "x-project-token": fixture.token };
  expect((await app.request(discoveryPath, { headers })).status).toBe(200);
  // When: the project requires sign-in without revoking its token.
  await app.runtime.db.run("UPDATE policy_sets SET policy_json=? WHERE scope_kind='project' AND scope_id=?",
    [JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: false }), ids.project]);
  // Then: discovery and every previously known resource require authentication.
  const responses = await Promise.all(fixture.paths.map(path => app.request(path, { headers })));
  expect(responses.map(response => response.status)).toEqual([401, 401, 401, 401]);
}, 90000);

test("discovers and downloads the real PDF when the typed client carries a Viewer token", async () => {
  // Given: the actual generated client and a live anonymous Viewer credential.
  await using app = await compilerHttp();
  const fixture = await linkedPreview(app);
  const client = createClient(app.url.origin);
  const headers = { "x-project-token": fixture.token };
  // When: the typed client follows the complete discovery and resource chain.
  const [state, job, log, content] = await Promise.all([
    client.call(endpoints.compilePreview, { params: { p: ids.project }, query: { branch: "main" }, body: undefined, headers }),
    client.call(endpoints.compileGet, { params: { id: fixture.job.id }, query: {}, body: undefined, headers }),
    client.call(endpoints.compileLog, { params: { id: fixture.job.id }, query: {}, body: undefined, headers }),
    client.call(endpoints.artifactContent, { params: { id: fixture.pdf.id }, query: {}, body: undefined, headers }),
  ]);
  // Then: schema parsing preserves the explicit token and genuine bytes on each call.
  if ("error" in state || "error" in job || "error" in log || "error" in content) {
    throw new TypeError("Typed token read was rejected");
  }
  expect(state.data.job?.id).toBe(fixture.job.id);
  expect(state.data.preview?.artifact.id).toBe(fixture.pdf.id);
  expect(job.data.id).toBe(fixture.job.id);
  expect(new TextDecoder().decode(log.data)).toContain("ha2018world");
  expect(await pdfText(content.data)).toContain("Latent Dynamics");
  const withoutToken = await client.call(endpoints.compilePreview, {
    params: { p: ids.project }, query: { branch: "main" }, body: undefined,
  });
  expect("error" in withoutToken && withoutToken.error.code).toBe("UNAUTHENTICATED");
}, 90000);
