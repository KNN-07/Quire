import { expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { z } from "zod";
import { endpoints, OnboardingSchema, ProjectSchema } from "@quire/contracts";
import type { Onboarding } from "@quire/contracts";
import { baseFixture, errorEnvelope } from "../../core/base/harness";

const envelope = z.object({ data: OnboardingSchema });
type Fixture = Awaited<ReturnType<typeof baseFixture>>;
type Actor = Awaited<ReturnType<Fixture["login"]>>;
async function ownedFixture(resources: AsyncDisposableStack) {
  const fixture = await baseFixture();
  console.info("ONBOARDING_NATIVE_OWNED", { root: fixture.path });
  resources.defer(async () => {
    expect(await access(fixture.path).then(() => true, () => false)).toBe(false);
    console.info("ONBOARDING_NATIVE_CLEANED", { root: fixture.path, exists: false });
  });
  return resources.use(fixture);
}
async function get(fixture: Fixture, actor: Actor) {
  const response = await fixture.request(endpoints.onboardingGet.path, { headers: actor.headers });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return envelope.parse(await response.json()).data;
}
async function mutate(fixture: Fixture, actor: Actor, path: string, body: unknown, key = crypto.randomUUID()) {
  return fixture.request(path, { method: path === endpoints.onboardingSave.path ? "PATCH" : "POST",
    headers: { ...actor.headers, "idempotency-key": key }, body: JSON.stringify(body) });
}
const version = (progress: Onboarding) => ({ actorId: progress.actorId, expectedVersion: progress.version });

test("actor-scoped onboarding rejects anonymous, CSRF, stale and previous-login writes; exact retry survives restart", async () => {
  let root = "";
  {
    await using resources = new AsyncDisposableStack();
    const fixture = await ownedFixture(resources);
    root = fixture.path;
    const actor = await fixture.login();
    const other = await fixture.login("operator@quire.local");
    expect((await fixture.request(endpoints.onboardingGet.path)).status).toBe(401);
    const initial = await get(fixture, actor);
    expect(initial).toMatchObject({ actorId: actor.user.id, schemaVersion: 1, version: 0, stage: "choosing" });
    const body = { ...version(initial), choices: { ...initial.choices, name: "Persisted thesis", writingKind: "thesis", defaultView: "source" } } as const;
    const key = crypto.randomUUID();
    const saved = await mutate(fixture, actor, endpoints.onboardingSave.path, body, key);
    expect(saved.status).toBe(200);
    const progress = envelope.parse(await saved.json()).data;
    expect(progress.version).toBe(1);
    expect(progress.choices).toEqual(body.choices);
    expect(envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingSave.path, body, key)).json()).data).toEqual(progress);
    const reused = await mutate(fixture, actor, endpoints.onboardingSave.path, { ...body, choices: initial.choices }, key);
    expect(errorEnvelope.parse(await reused.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
    const stale = await mutate(fixture, actor, endpoints.onboardingSave.path, body);
    expect(stale.status).toBe(409);
    expect(errorEnvelope.parse(await stale.json()).error.code).toBe("VERSION_CONFLICT");
    const switched = await mutate(fixture, other, endpoints.onboardingSave.path, body);
    expect(errorEnvelope.parse(await switched.json()).error.code).toBe("SESSION_CHANGED");
    expect((await get(fixture, other)).version).toBe(0);
    const csrf = await fixture.request(endpoints.onboardingSave.path, { method: "PATCH",
      headers: { cookie: actor.headers.cookie, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
    expect(csrf.status).toBe(403);
    const competing = await Promise.all(["A", "B"].map(name => mutate(fixture, actor, endpoints.onboardingSave.path,
      { ...version(progress), choices: { ...progress.choices, name } })));
    expect(competing.map(response => response.status).sort((left, right) => left - right)).toEqual([200, 409]);
    const beforeRestart = await get(fixture, actor);
    await fixture.restart();
    expect(await get(fixture, actor)).toEqual(beforeRestart);
    expect(envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingSave.path, body, key)).json()).data).toEqual(progress);
    console.info("ONBOARDING_NATIVE_CAS", { actor: actor.user.id, isolatedActor: other.user.id,
      stale: 409, switched: 409, concurrent: [200, 409], restartVersion: beforeRestart.version });
  }
  expect(await access(root).then(() => true, () => false)).toBe(false);
  console.info("ONBOARDING_NATIVE_CLEANED", { root, exists: false });
}, 90_000);

test("frozen create intent recovers its actual project receipt after lost response and restart without duplication", async () => {
  await using resources = new AsyncDisposableStack();
  const fixture = await ownedFixture(resources);
  const actor = await fixture.login();
  const initial = await get(fixture, actor);
  const started = await mutate(fixture, actor, endpoints.onboardingStart.path, version(initial));
  expect(started.status).toBe(200);
  const progress = envelope.parse(await started.json()).data;
  expect(progress.stage).toBe("creating");
  expect(progress.createKey).not.toBeNull();
  const pending = await mutate(fixture, actor, endpoints.onboardingComplete.path, version(progress));
  expect(errorEnvelope.parse(await pending.json()).error.code).toBe("PROJECT_PENDING");
  const change = await mutate(fixture, actor, endpoints.onboardingSave.path,
    { ...version(progress), choices: { ...progress.choices, name: "Duplicate attempt" } });
  expect(errorEnvelope.parse(await change.json()).error.code).toBe("ONBOARDING_STARTED");
  await fixture.restart();
  const resumed = await get(fixture, actor);
  expect(resumed).toEqual(progress);
  if (!resumed.createKey) throw new Error("Persisted create key missing");
  const request = () => fixture.request(endpoints.projectCreate.path, { method: "POST",
    headers: { ...actor.headers, "idempotency-key": resumed.createKey ?? "" },
    body: JSON.stringify({ name: resumed.choices.name, origin: resumed.choices.origin }) });
  const created = z.object({ data: ProjectSchema }).parse(await (await request()).json()).data;
  await fixture.restart();
  expect((await get(fixture, actor)).stage).toBe("creating");
  const replay = z.object({ data: ProjectSchema }).parse(await (await request()).json()).data;
  expect(replay.id).toBe(created.id);
  const completeBody = version(resumed);
  const completeKey = crypto.randomUUID();
  const complete = await mutate(fixture, actor, endpoints.onboardingComplete.path, completeBody, completeKey);
  expect(complete.status).toBe(200);
  const completed = envelope.parse(await complete.json()).data;
  expect(completed).toMatchObject({ stage: "complete", projectId: created.id, createKey: resumed.createKey });
  expect(envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingComplete.path, completeBody, completeKey)).json()).data).toEqual(completed);
  const preferenceFailure = await fixture.request(endpoints.preferencesPatch.path, { method: "PATCH", headers: actor.headers,
    body: JSON.stringify({ expectedVersion: 9999, defaultView: "visual" }) });
  expect(preferenceFailure.status).toBe(409);
  await fixture.restart();
  expect(await get(fixture, actor)).toEqual(completed);
  expect(envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingStart.path, version(completed))).json()).data).toEqual(completed);
  const count = z.object({ count: z.number() }).parse(await fixture.runtime.db.get(
    "SELECT COUNT(*) AS count FROM projects WHERE owner_id=? AND name=?", [actor.user.id, initial.choices.name]));
  expect(count.count).toBe(1);
  const files = await fixture.service.listFiles({ projectId: created.id, branch: created.defaultBranch });
  expect(files.map(file => file.path)).toEqual(["main.tex"]);
  console.info("ONBOARDING_NATIVE_RECEIPT", { projectId: created.id, count: count.count,
    frozenKey: resumed.createKey, completedVersion: completed.version, preferenceFailure: 409, restart: true });
}, 90_000);

test("import is a persisted continuation, never a fabricated completed project", async () => {
  await using resources = new AsyncDisposableStack();
  const fixture = await ownedFixture(resources);
  const actor = await fixture.login();
  const initial = await get(fixture, actor);
  const saved = envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingSave.path,
    { ...version(initial), choices: { ...initial.choices, origin: { kind: "import" } } })).json()).data;
  const started = envelope.parse(await (await mutate(fixture, actor, endpoints.onboardingStart.path, version(saved))).json()).data;
  expect(started).toMatchObject({ stage: "import", projectId: null, createKey: null });
  expect(started.choices.origin.kind).toBe("import");
  const complete = await mutate(fixture, actor, endpoints.onboardingComplete.path, version(started));
  expect(errorEnvelope.parse(await complete.json()).error.code).toBe("PROJECT_PENDING");
  await fixture.restart();
  expect(await get(fixture, actor)).toEqual(started);
  console.info("ONBOARDING_NATIVE_IMPORT", { stage: started.stage, projectId: null, restart: true });
}, 90_000);
