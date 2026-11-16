import { expect, test } from "bun:test";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { FileEntrySchema, IdSchema, OperationSchema } from "@quire/contracts";
import { readZip } from "../../../../services/core/base";
import { ExecutionLaunchSchema, ExecutionProfileSchema } from "../../../../services/operations/installation/execution-model";
import { describeExecutionSource } from "../../../../services/operations/installation/execution-source";
import { inspectOwnedContainer } from "../../../../services/operations/installation/execution-docker";
import { inspectUnit, cgroupPids } from "../../../../services/operations/installation/systemd-process";
import { executionFixture, id } from "./fixture";

const image = z.string({ error: "Set QUIRE_PANDOC_IMAGE to an installed immutable Pandoc image ID" })
  .regex(/^sha256:[a-f0-9]{64}$/, "QUIRE_PANDOC_IMAGE must be a local immutable sha256 image ID")
  .parse(Bun.env["QUIRE_PANDOC_IMAGE"]);
const limits = { wallSeconds: 60, memoryBytes: 536870912, processes: 64, workspaceBytes: 67108864 };
const profile = ExecutionProfileSchema.parse({ id: "pandoc", roles: ["api-a"],
  kinds: ["pandoc-probe", "document-convert"], backend: "docker", image, limits, maxConcurrent: 4 });
const envelope = z.object({ data: OperationSchema });

test("installed HTTP import and export use signed Pandoc recipes and release all owned executions", async () => {
  await using fixture = await executionFixture({ image, profiles: [profile,
    { ...profile, id: "native-denied", roles: ["api-b"], backend: "bwrap" },
    { ...profile, id: "absent-image", roles: ["api-b"], image: `sha256:${"0".repeat(64)}` }],
    release: "tests/operations/installation/supervisor-execution/pandoc-release.ts" });
  const controller = await fixture.start();
  if (fixture.prior.data.dialect !== "sqlite") throw new Error("SQLite fixture required");
  const workRoot = join(fixture.prior.data.dataRoot, "work");
  const api = z.object({ url: z.url(), parent: IdSchema }).parse(JSON.parse(
    await readFile(join(workRoot, "pandoc-api-a.json"), "utf8")));
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", "http://localhost:5173");
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(path, api.url), { ...init, headers, signal: AbortSignal.timeout(90000) });
  };
  const login = await request("/api/auth/login", { method: "POST",
    body: JSON.stringify({ email: "kien@quire.local", password: "p9-owned-execution-fixture" }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Session cookie required");
  const me = await request("/api/me", { headers: { cookie } });
  const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
  const headers = { cookie, "x-csrf-token": csrf };
  const markdown = "# Installed Pandoc evidence\n\nPreserved **structure** and $x^2$.\n";
  const imported = await request("/api/imports", { method: "POST", headers: { ...headers, "idempotency-key": id() },
    body: JSON.stringify({ kind: "markdown", name: "Installed Pandoc", source: { kind: "snippet", text: markdown } }) });
  const importBody: unknown = await imported.json();
  expect(imported.status, JSON.stringify(importBody)).toBe(202);
  const projectId = z.object({ projectIds: z.array(z.string()).min(1) }).parse(envelope.parse(importBody).data.result).projectIds[0];
  if (!projectId) throw new Error("Imported project required");
  const files = z.object({ data: z.array(FileEntrySchema) }).parse(await (
    await request(`/api/projects/${projectId}/files?branch=main`, { headers })).json()).data;
  const original = files.find(file => file.path === "originals/original.md");
  if (!original) throw new Error("Original required");
  expect(await (await request(`/api/projects/${projectId}/files/${original.id}/content?branch=main`, { headers })).text()).toBe(markdown);
  let docx: Uint8Array | undefined;
  const evidence: { kind: string; bytes: number; sha256: string; paths: string[] }[] = [];
  for (const kind of ["docx", "markdown", "html"]) {
    const exported = await request(`/api/projects/${projectId}/exports`, { method: "POST",
      headers: { ...headers, "idempotency-key": id() }, body: JSON.stringify({ kind }) });
    const body: unknown = await exported.json();
    expect(exported.status, JSON.stringify(body)).toBe(202);
    const operation = envelope.parse(body).data;
    const download = await request(`/api/operations/${operation.id}/download`, { headers });
    expect(download.status).toBe(200);
    const bytes = new Uint8Array(await download.arrayBuffer());
    const entries = readZip(bytes);
    const document = entries.find(entry => entry.path.startsWith("converted/document."));
    if (!document) throw new Error("Real converted document required");
    if (kind === "docx") {
      docx = document.bytes;
      expect(readZip(docx).some(entry => entry.path === "word/document.xml")).toBe(true);
    } else expect(new TextDecoder().decode(document.bytes)).toContain("Installed Pandoc evidence");
    evidence.push({ kind, bytes: bytes.byteLength,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), paths: entries.map(entry => entry.path) });
    if (Bun.env["QUIRE_INTERCHANGE_EVIDENCE"]) {
      await Bun.write(join(Bun.env["QUIRE_INTERCHANGE_EVIDENCE"], `installed-${kind}.zip`), bytes);
    }
  }
  if (!docx) throw new Error("DOCX required");
  const form = new FormData();
  form.set("kind", "docx"); form.set("name", "Installed DOCX");
  form.set("source", new File([new Uint8Array(docx)], "fixture.docx"));
  const docxImport = await request("/api/imports", { method: "POST",
    headers: { ...headers, "idempotency-key": id() }, body: form });
  const docxBody: unknown = await docxImport.json();
  expect(docxImport.status, JSON.stringify(docxBody)).toBe(202);
  const docxId = z.object({ projectIds: z.array(z.string()).min(1) }).parse(envelope.parse(docxBody).data.result).projectIds[0];
  const docxFiles = z.object({ data: z.array(FileEntrySchema) }).parse(await (
    await request(`/api/projects/${docxId}/files?branch=main`, { headers })).json()).data;
  const preserved = docxFiles.find(file => file.path === "originals/original.docx");
  if (!preserved) throw new Error("Preserved DOCX required");
  expect(new Uint8Array(await (await request(`/api/projects/${docxId}/files/${preserved.id}/content?branch=main`, { headers })).arrayBuffer())).toEqual(new Uint8Array(docx));
  const after = z.object({ data: z.array(FileEntrySchema) }).parse(await (
    await request(`/api/projects/${projectId}/files?branch=main`, { headers })).json()).data;
  expect(after.map(file => file.path)).toEqual(files.map(file => file.path));
  const records = z.object({ launches: z.array(ExecutionLaunchSchema) }).parse(await controller.request("records", {}));
  expect(records.launches.length).toBe(6);
  expect(records.launches.filter(launch => launch.request.work.kind === "pandoc-probe").length).toBe(1);
  for (const launch of records.launches) {
    expect(launch.parentExecutionId).toBe(api.parent);
    expect(launch.profile.image).toBe(image);
    expect(launch.state).toBe("released");
    expect(launch.result).toMatchObject({ code: 0, canceled: false, interrupted: false });
    expect(await inspectOwnedContainer("/run/docker.sock", launch)).toBeNull();
    const unit = await inspectUnit(fixture.config, launch.unit);
    expect(unit.mainPid).toBe(0);
    if (unit.cgroup) expect(await cgroupPids(unit.cgroup)).toEqual([]);
  }
  expect((await readdir(workRoot)).filter(name => name.startsWith("quire-interchange-"))).toEqual([]);
  console.info("P74_INSTALLED_HTTP", JSON.stringify({ projectId, docxId, image, evidence,
    launches: records.launches.map(launch => ({ id: launch.id, kind: launch.request.work.kind, state: launch.state, result: launch.result })) }));

  const sourcePath = join(workRoot, "denied");
  await mkdir(sourcePath);
  const source = await describeExecutionSource(sourcePath, limits.workspaceBytes);
  const work = { kind: "pandoc-probe", source };
  for (const [role, profileId, expected] of [
    ["api-b", "pandoc", "CONTROL_EXECUTION_POLICY_DENIED"],
    ["api-b", "native-denied", "CONTROL_EXECUTION_POLICY_DENIED"],
    ["api-a", "unsigned", "CONTROL_EXECUTION_PROFILE_REQUIRED"],
    ["api-a", `sha256:${"1".repeat(64)}`, "CONTROL_EXECUTION_PROFILE_REQUIRED"],
  ]) {
    const denied = await fixture.role(role).channel.request("start", { requestId: id(), profileId, work, limits })
      .then(() => null, (error: unknown) => error);
    expect(denied).toMatchObject({ code: expected });
  }
  const tooLarge = await fixture.role().channel.request("start", {
    requestId: id(), profileId: "pandoc", work, limits: { ...limits, processes: 65 },
  }).then(() => null, (error: unknown) => error);
  expect(tooLarge).toMatchObject({ code: "CONTROL_EXECUTION_POLICY_DENIED" });
  const unavailable = await fixture.role("api-b").channel.request("start", {
    requestId: id(), profileId: "absent-image", work, limits,
  }).then(() => null, (error: unknown) => error);
  expect(unavailable).toMatchObject({ code: "CONTROL_EXECUTION_NOT_STARTED" });
  const failedRecords = z.object({ launches: z.array(ExecutionLaunchSchema) }).parse(await controller.request("records", {}));
  const failed = failedRecords.launches.find(launch => launch.profile.id === "absent-image");
  if (!failed) throw new Error("Unavailable image launch evidence required");
  expect(failed.result).toMatchObject({ code: null, interrupted: true });
  expect(await inspectOwnedContainer("/run/docker.sock", failed)).toBeNull();
  await fixture.role("api-b").channel.request("release", { id: failed.id });
}, 240000);
