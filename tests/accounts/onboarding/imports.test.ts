import { expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { z } from "zod";
import { zipSync } from "fflate";
import { DigestSchema, endpoints, OnboardingSchema, OperationSchema } from "@quire/contracts";
import type { Onboarding, OnboardingImportFile } from "@quire/contracts";
import { interchangeFixture } from "../../adapters/interchange/harness";

type Fixture = Awaited<ReturnType<typeof interchangeFixture>>;
type Actor = Awaited<ReturnType<Fixture["login"]>>;
const envelope = z.object({ data: OnboardingSchema });
const recovered = z.object({ data: endpoints.onboardingImportRecover.output });
const tex = new TextEncoder().encode("\\documentclass{article}\n\\begin{document}Durable onboarding import\\end{document}\n");
const archive = zipSync({ "main.tex": tex });
const file: OnboardingImportFile = {
  filename: "onboarding.zip", mime: "application/zip", bytes: archive.length,
  sha256: DigestSchema.parse(new Bun.CryptoHasher("sha256").update(archive).digest("hex")),
};
async function owned(resources: AsyncDisposableStack) {
  const fixture = await interchangeFixture();
  console.info("ONBOARDING_IMPORT_NATIVE_OWNED", fixture.path);
  resources.defer(async () => {
    expect(await access(fixture.path).then(() => true, () => false)).toBe(false);
    console.info("ONBOARDING_IMPORT_NATIVE_CLEANED", { root: fixture.path, exists: false });
  });
  return resources.use(fixture);
}
async function mutate(fixture: Fixture, actor: Actor, path: string, body: unknown, key = crypto.randomUUID()) {
  return fixture.request(path, { method: path === endpoints.onboardingSave.path || path === endpoints.onboardingImportSave.path ? "PATCH" : "POST",
    headers: { ...actor.headers, "idempotency-key": key }, body: JSON.stringify(body) });
}
const version = (progress: Onboarding) => ({ actorId: progress.actorId, expectedVersion: progress.version });
async function choose(fixture: Fixture, actor: Actor) {
  const initial = envelope.parse(await (await fixture.request(endpoints.onboardingGet.path, { headers: actor.headers })).json()).data;
  const choice = envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingSave.path,
    { ...version(initial), choices: { ...initial.choices, name: "Durable ZIP", origin: { kind: "import" } } })).json()).data;
  return envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingStart.path, version(choice))).json()).data;
}
async function recover(fixture: Fixture, actor: Actor) {
  const response = await mutate(fixture, actor, endpoints.onboardingImportRecover.path, { actorId: actor.user.id });
  expect(response.status, await response.clone().text()).toBe(200);
  return recovered.parse(await response.json()).data;
}
async function stage(fixture: Fixture, actor: Actor, progress: Onboarding) {
  const attempt = progress.importState?.attempt;
  if (!attempt?.uploadKey) throw new Error("Persisted upload key missing");
  const form = new FormData();
  form.set("file", new File([archive], file.filename, { type: file.mime }));
  const response = await fixture.request(endpoints.importUploadCreate.path, { method: "POST",
    headers: { ...actor.headers, "idempotency-key": attempt.uploadKey }, body: form });
  expect(response.status, await response.clone().text()).toBe(201);
  return response;
}
async function dispatch(fixture: Fixture, actor: Actor, progress: Onboarding) {
  const attempt = progress.importState?.attempt;
  if (!attempt?.request) throw new Error("Frozen import request missing");
  return fixture.request(endpoints.importCreate.path, { method: "POST",
    headers: { ...actor.headers, "idempotency-key": attempt.key }, body: JSON.stringify(attempt.request) });
}

test("import drafts use actor/CAS guards and a frozen key exists before upload or dispatch", async () => {
  await using resources = new AsyncDisposableStack();
  const fixture = await owned(resources);
  const actor = await fixture.login();
  const other = await fixture.login("operator@quire.local");
  const progress = await choose(fixture, actor);
  if (!progress.importState) throw new Error("Import draft missing");
  const body = { ...version(progress), draft: { ...progress.importState.draft, name: "Saved ZIP draft" } };
  const saved = envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingImportSave.path, body)).json()).data;
  expect((await mutate(fixture, actor, endpoints.onboardingImportSave.path, body)).status).toBe(409);
  expect((await mutate(fixture, other, endpoints.onboardingImportSave.path, body)).status).toBe(409);
  const deniedUrl = await mutate(fixture, actor, endpoints.onboardingImportSave.path,
    { ...version(saved), draft: { ...body.draft, mode: "git", url: "https://user:secret@example.test/repo" } });
  expect(deniedUrl.status).toBe(400);
  const startKey = crypto.randomUUID();
  const startBody = { ...version(saved), file };
  const started = envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingImportStart.path, startBody, startKey)).json()).data;
  expect(started.importState?.attempt).toMatchObject({ file, upload: null, request: null, operationId: null });
  expect(started.importState?.attempt?.key).toBeTruthy();
  expect(started.importState?.attempt?.uploadKey).toBeTruthy();
  expect(envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingImportStart.path, startBody, startKey)).json()).data).toEqual(started);
  expect((await mutate(fixture, actor, endpoints.onboardingImportSave.path, { ...body, ...version(started) })).status).toBe(409);
  await fixture.restart();
  expect((await recover(fixture, actor)).progress).toEqual(started);
  const otherState = await mutate(fixture, other, endpoints.onboardingImportRecover.path, { actorId: actor.user.id });
  expect(otherState.status).toBe(409);
});

test("lost upload and import responses recover by durable actor/key receipts without another project", async () => {
  await using resources = new AsyncDisposableStack();
  const fixture = await owned(resources);
  const actor = await fixture.login();
  const progress = await choose(fixture, actor);
  const started = envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingImportStart.path,
    { ...version(progress), file })).json()).data;
  await stage(fixture, actor, started); // Deliberately discard the successful upload response.
  await fixture.restart();
  const uploaded = await recover(fixture, actor);
  expect(uploaded.operation).toBeNull();
  expect(uploaded.progress.importState?.attempt?.upload?.sha256).toBe(file.sha256);
  expect(uploaded.progress.importState?.attempt?.request?.source.kind).toBe("upload");
  await stage(fixture, actor, started);
  expect(await fixture.runtime.db.get("SELECT COUNT(*) AS count FROM interchange_uploads WHERE owner_id=?", [actor.user.id])).toEqual({ count: 1 });
  const imported = await dispatch(fixture, actor, uploaded.progress);
  expect(imported.status, await imported.clone().text()).toBe(202);
  await fixture.restart(); // No returned operation ID was ever saved by this caller.
  const resumed = await recover(fixture, actor);
  expect(resumed.operation?.status).toBe("succeeded");
  if (!resumed.operation) throw new Error("Persisted operation missing");
  expect(resumed.progress.stage).toBe("complete");
  expect(resumed.progress.projectId).toBeTruthy();
  expect(resumed.progress.importState?.attempt?.operationId).toBe(resumed.operation?.id ?? null);
  const replay = z.object({ data: OperationSchema }).parse(await (await dispatch(fixture, actor, uploaded.progress)).json()).data;
  expect(replay.id).toBe(resumed.operation?.id);
  expect(await fixture.runtime.db.get("SELECT COUNT(*) AS count FROM projects WHERE owner_id=? AND name='Durable ZIP'", [actor.user.id])).toEqual({ count: 1 });
  expect(await recover(fixture, actor)).toEqual(resumed);
  console.info("ONBOARDING_IMPORT_RECEIPT_RECOVERY", { key: started.importState?.attempt?.key,
    uploadKey: started.importState?.attempt?.uploadKey, operationId: replay.id,
    projectId: resumed.progress.projectId, uploadCount: 1, projectCount: 1, restart: true });
});

test("interrupted operation publication replays the frozen staged source without creating another project", async () => {
  await using resources = new AsyncDisposableStack();
  const fixture = await owned(resources);
  const actor = await fixture.login();
  const progress = await choose(fixture, actor);
  const started = envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingImportStart.path,
    { ...version(progress), file })).json()).data;
  await stage(fixture, actor, started);
  const uploaded = await recover(fixture, actor);
  const attempt = uploaded.progress.importState?.attempt;
  if (!attempt?.request || !attempt.upload) throw new Error("Staged source missing");
  const canonical = endpoints.importCreate.input.parse({ params: {}, query: {}, body: attempt.request,
    headers: { "idempotency-key": attempt.key } }).body;
  const project = await fixture.service.createFromFiles(actor.user.id, {
    name: attempt.request.name, entries: [{ path: "main.tex", bytes: tex }],
    http: { actorId: actor.user.id, key: attempt.key, route: "importCreate:source",
      digest: new Bun.CryptoHasher("sha256").update(JSON.stringify(canonical)).digest("hex") },
  });
  await fixture.runtime.db.run("UPDATE interchange_uploads SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", [attempt.upload.id]);
  await fixture.restart();
  expect((await recover(fixture, actor)).operation).toBeNull();
  const response = await dispatch(fixture, actor, uploaded.progress);
  expect(response.status, await response.clone().text()).toBe(202);
  const complete = await recover(fixture, actor);
  expect(complete.progress.projectId).toBe(project.id);
  expect(await fixture.runtime.db.get("SELECT COUNT(*) AS count FROM projects WHERE owner_id=? AND name='Durable ZIP'", [actor.user.id])).toEqual({ count: 1 });
  console.info("ONBOARDING_IMPORT_SOURCE_RECOVERY", { projectId: project.id, operationId: complete.operation?.id,
    expiredUploadNotReread: true, projectCount: 1 });
});

test("remote compiler and disconnected snapshot choices remain frozen across restart", async () => {
  await using resources = new AsyncDisposableStack();
  const fixture = await owned(resources);
  const actor = await fixture.login();
  const progress = await choose(fixture, actor);
  if (!progress.importState) throw new Error("Import state required");
  const draft = { ...progress.importState.draft, mode: "github", name: "Frozen remote choices",
    url: "https://example.invalid/research.git", branch: "main", mainPath: "chosen.tex",
    engine: "xelatex", preserveHistory: false, keepConnected: false };
  const saved = envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingImportSave.path,
    { ...version(progress), draft })).json()).data;
  const started = envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingImportStart.path,
    { ...version(saved), file: null })).json()).data;
  expect(started.importState?.attempt?.request).toMatchObject({
    kind: "github", mainPath: "chosen.tex", engine: "xelatex", preserveHistory: false, keepConnected: false,
  });
  expect((await mutate(fixture, actor, endpoints.onboardingImportSave.path, {
    ...version(started), draft: { ...draft, preserveHistory: true, keepConnected: true },
  })).status).toBe(409);
  await fixture.restart();
  expect((await recover(fixture, actor)).progress.importState?.attempt).toEqual(started.importState?.attempt);
});
