import { expect, test } from "bun:test";
import { z } from "zod";
import { CompileJobSchema, FileEntrySchema, ProjectSchema, endpointRegistry, endpoints } from "@quire/contracts";
import { applicationFixture, mutation } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { p2Endpoints } from "./p2-surface";

test("P1 default composition persists source, compiles a real PDF and denies Viewer writes", async () => {
  await using fixture = await applicationFixture();
  const owner = await fixture.login();
  const response = await fixture.request("/api/projects", mutation(owner.headers, {
    name: "P1 combined application", origin: { kind: "example" },
  }));
  expect(response.status, await response.clone().text()).toBe(endpoints.projectCreate.successStatus);
  const project = z.object({ data: ProjectSchema }).parse(await response.json()).data;
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const files = await fixture.request(`/api/projects/${project.id}/files?branch=main`, { headers: owner.headers });
  const revision = Number(files.headers.get("etag")?.match(/^"v(\d+)"$/)?.[1]);
  expect(Number.isInteger(revision)).toBe(true);
  const created = await fixture.request(`/api/projects/${project.id}/files`, mutation(owner.headers, {
    scope, path: "persisted.tex", kind: "file", text: "Durable P1 source: Việt 😀", expectedVersion: revision,
  }));
  expect(created.status, await created.clone().text()).toBe(endpoints.fileCreate.successStatus);
  const file = z.object({ data: FileEntrySchema }).parse(await created.json()).data;
  await fixture.restart();
  const content = await fixture.request(`/api/projects/${project.id}/files/${file.id}/content?branch=main`, { headers: owner.headers });
  expect(await content.text()).toBe("Durable P1 source: Việt 😀");
  const currentFiles = await fixture.request(`/api/projects/${project.id}/files?branch=main`, { headers: owner.headers });
  const currentRevision = Number(currentFiles.headers.get("etag")?.match(/^"v(\d+)"$/)?.[1]);
  const viewer = await fixture.login("alex@quire.local");
  const denied = await fixture.request(`/api/projects/${ids.project}/compiles`, mutation(viewer.headers, {
    scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0, clean: true,
  }));
  expect(denied.status).toBe(403);
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await denied.json()).error.code).toBe("FORBIDDEN");
  const complete = Promise.withResolvers<void>();
  const signal = AbortSignal.timeout(90000);
  const abort = () => complete.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const unsubscribe = fixture.app.runtime.events.subscribe(event => {
    if (event.topic === "job.changed" && !["queued", "running"].includes(event.payload.status)) complete.resolve();
  });
  try {
    await fixture.app.start();
    const admitted = await fixture.request(`/api/projects/${project.id}/compiles`, mutation(owner.headers, {
      scope, expectedRevision: currentRevision, clean: true,
    }));
    expect(admitted.status, await admitted.clone().text()).toBe(202);
    const job = z.object({ data: CompileJobSchema }).parse(await admitted.json()).data;
    await complete.promise;
    const result = await fixture.request(`/api/compiles/${job.id}`, { headers: owner.headers });
    const finished = z.object({ data: CompileJobSchema }).parse(await result.json()).data;
    const log = await fixture.request(`/api/compiles/${job.id}/log`, { headers: owner.headers });
    const buildLog = await log.text();
    if (finished.status !== "succeeded") console.error("P1_COMPILE_LOG", buildLog);
    expect(finished.status, buildLog).toBe("succeeded");
    expect(finished.diagnostics.filter(item => item.severity === "error")).toEqual([]);
    const pdf = finished.artifacts.find(artifact => artifact.kind === "pdf");
    if (!pdf) throw new TypeError("Successful native compile returned no PDF");
    const download = await fixture.request(`/api/artifacts/${pdf.id}/content`, { headers: owner.headers });
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect((await download.text()).startsWith("%PDF-")).toBe(true);
    console.info("P1_REAL_PDF", { projectId: project.id, jobId: job.id, bytes: pdf.bytes, sha256: pdf.sha256 });
  } finally {
    unsubscribe(); signal.removeEventListener("abort", abort);
  }
}, 180000);

test("P1 default composition reports the actual remaining registry surface", async () => {
  await using fixture = await applicationFixture();
  // Probe the actual registry with no session; malformed mutations cannot change data.
  const missing: string[] = [];
  for (const endpoint of endpointRegistry) {
    const path = endpoint.path.replace(/:\w+/g, ids.project).replace("*", "info/refs");
    const probe = await fixture.app.fetch(new Request(`http://localhost${path}?branch=main`, {
      method: endpoint.method, headers: { "content-type": "application/json", "idempotency-key": "inventory", "if-match": '"v0"' },
      ...(endpoint.method === "GET" ? {} : { body: "{}" }),
    }));
    if (probe.status === 501) missing.push(Object.entries(endpoints).find(([, route]) => route === endpoint)?.[0] ?? endpoint.path);
  }
  console.info("P1_REMAINING_501", JSON.stringify(missing));
  console.info("P1_REGISTRY", { total: endpointRegistry.length, implemented: endpointRegistry.length - missing.length, remaining: missing.length });
  expect([...missing].sort()).toEqual([...p2Endpoints].sort());
}, 90000);

test("P1 default worker publishes a genuine PDF for the seeded paper", async () => {
  await using fixture = await applicationFixture();
  const owner = await fixture.login();
  const complete = Promise.withResolvers<void>();
  const signal = AbortSignal.timeout(90000);
  const abort = () => complete.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const unsubscribe = fixture.app.runtime.events.subscribe(event => {
    if (event.topic === "job.changed" && !["queued", "running"].includes(event.payload.status)) complete.resolve();
  });
  try {
    await fixture.app.start();
    const admitted = await fixture.request(`/api/projects/${ids.project}/compiles`, mutation(owner.headers, {
      scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0, clean: true,
    }));
    expect(admitted.status, await admitted.clone().text()).toBe(202);
    const job = z.object({ data: CompileJobSchema }).parse(await admitted.json()).data;
    await complete.promise;
    const response = await fixture.request(`/api/compiles/${job.id}`, { headers: owner.headers });
    const finished = z.object({ data: CompileJobSchema }).parse(await response.json()).data;
    expect(finished.status, finished.failureCode ?? "").toBe("succeeded");
    expect(finished.diagnostics.filter(item => item.severity === "error")).toEqual([]);
    const pdf = finished.artifacts.find(artifact => artifact.kind === "pdf");
    if (!pdf) throw new TypeError("Successful native compile returned no PDF");
    const content = await fixture.request(`/api/artifacts/${pdf.id}/content`, { headers: owner.headers });
    expect(content.headers.get("content-type")).toBe("application/pdf");
    expect((await content.text()).startsWith("%PDF-")).toBe(true);
    console.info("P1_SEEDED_REAL_PDF", { jobId: job.id, bytes: pdf.bytes, sha256: pdf.sha256 });
  } finally {
    unsubscribe(); signal.removeEventListener("abort", abort);
  }
}, 180000);
