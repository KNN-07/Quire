import { expect, test } from "bun:test";
import { z } from "zod";
import { EnvironmentSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { environmentFixture } from "./harness";
import { verifiedReport } from "./image";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { saveEnvironment, resolveEnvironment } from "../../../services/operations/environments/registry";
import { ManifestInputSchema } from "../../../services/operations/environments/model";
import { rejectionCode } from "./error";

async function setupManifest(fixture: Awaited<ReturnType<typeof environmentFixture>>) {
  const manifest = manifestFromProbe({id:crypto.randomUUID(),label:"Owned executed profile",report:await verifiedReport()});
  const operator=await fixture.login();
  await saveEnvironment(fixture.context,{manifest,report:await verifiedReport(),actor:operator.actor});
  return manifest;
}
test("lists actual environments only when the session is an operator",async()=>{
  // Given: real authenticated sessions and SQL.
  await using fixture = await environmentFixture();
  const viewer = await fixture.login("alex@quire.local");
  const operator = await fixture.login();
  // When: sessions access the real operator surface.
  const allowed = await operator.get("/api/admin/environments");
  // Then: persisted environments are visible only to the operator.
  expect(allowed.status).toBe(200);
  expect(z.object({data:z.object({items:z.array(EnvironmentSchema)})}).parse(await allowed.json()).data.items.length).toBeGreaterThan(0);
  expect((await viewer.get("/api/admin/environments")).status).toBe(403);
  expect((await fixture.request("/api/admin/environments")).status).toBe(401);
},180000);
test("requires CSRF before an operator can change the default",async()=>{
  // Given: a real operator cookie without its CSRF token.
  await using fixture = await environmentFixture();
  const operator = await fixture.login();
  // When: the operator posts a mutation with only the cookie.
  const response = await fixture.request(`/api/admin/environments/${fixtureIds.environment}/default`,{
    method:"POST",headers:{cookie:operator.headers.cookie},body:JSON.stringify({expectedVersion:0})});
  // Then: identity's current mutation boundary rejects it.
  expect(response.status).toBe(403);
},180000);
test("preserves current project pins when a new environment becomes default",async()=>{
  // Given: a real executed alternate environment and an existing project pin.
  await using fixture = await environmentFixture();
  const manifest = await setupManifest(fixture);
  const original = await fixture.runtime.db.get<{settings_json:string}>("SELECT settings_json FROM projects WHERE id=?",[fixtureIds.project]);
  const operator = await fixture.login();
  // When: the operator confirms the exact current environment version.
  const response = await operator.write(`/api/admin/environments/${manifest.id}/default`,{expectedVersion:0});
  // Then: only default selection changes; the pinned project's source setting is preserved.
  expect(response.status).toBe(200);
  expect((await fixture.runtime.db.get<{settings_json:string}>("SELECT settings_json FROM projects WHERE id=?",[fixtureIds.project]))?.settings_json).toBe(original?.settings_json);
  expect((await fixture.runtime.db.get<{is_default:number}>("SELECT is_default FROM environments WHERE id=?",[manifest.id]))?.is_default).toBe(1);
},180000);
test("rejects stale confirmation when environment state changed",async()=>{
  // Given: a default mutation already advanced version zero.
  await using fixture = await environmentFixture();
  const manifest = await setupManifest(fixture);
  const operator = await fixture.login();
  expect((await operator.write(`/api/admin/environments/${manifest.id}/default`,{expectedVersion:0})).status).toBe(200);
  // When: a stale confirmation repeats the old version.
  const response = await operator.write(`/api/admin/environments/${manifest.id}/retire`,{expectedVersion:0});
  // Then: it fails instead of silently overriding newer state.
  expect(response.status).toBe(409);
  expect(z.object({error:z.object({code:z.string()})}).parse(await response.json()).error.code).toBe("VERSION_CONFLICT");
},180000);
test("blocks retirement when a live project pins the environment",async()=>{
  // Given: the seeded project still pins the original native environment.
  await using fixture = await environmentFixture();
  const operator = await fixture.login();
  // When: the operator attempts to retire that immutable ID.
  const response = await operator.write(`/api/admin/environments/${fixtureIds.environment}/retire`,{expectedVersion:0});
  // Then: retirement is rejected while the project remains pinned.
  expect(response.status).toBe(409);
  expect(z.object({error:z.object({code:z.string()})}).parse(await response.json()).error.code).toBe("ENVIRONMENT_PINNED");
},180000);
test("retires an unused environment and rejects later execution",async()=>{
  // Given: an executed, unused immutable manifest.
  await using fixture = await environmentFixture();
  const manifest = await setupManifest(fixture);
  const operator = await fixture.login();
  // When: the operator confirms retirement.
  const response = await operator.write(`/api/admin/environments/${manifest.id}/retire`,{expectedVersion:0});
  // Then: execution becomes unavailable while the immutable manifest bytes remain.
  expect(response.status).toBe(200);
  expect(await rejectionCode(resolveEnvironment(fixture.context,manifest.id))).toBe("ENVIRONMENT_UNAVAILABLE");
  const row = await fixture.runtime.db.get<{manifest_json:string}>("SELECT manifest_json FROM environments WHERE id=?",[manifest.id]);
  expect(row?.manifest_json).toBe(JSON.stringify(manifest));
},180000);
test("creates availability from actual probes and replays an identical request key",async()=>{
  // Given: a manifest with digests independently obtained from real execution.
  await using fixture = await environmentFixture();
  const manifest = manifestFromProbe({id:crypto.randomUUID(),label:"HTTP executed profile",report:await verifiedReport()});
  const operator = await fixture.login();
  const body = {manifest:ManifestInputSchema.parse(manifest)};
  const key = crypto.randomUUID();
  const first = await operator.write("/api/admin/environments",body,key);
  expect(first.status).toBe(200);
  const initial = z.object({data:EnvironmentSchema}).parse(await first.json()).data;
  // When: the caller retries the same request key.
  const replay = await operator.write("/api/admin/environments",body,key);
  // Then: it receives the same actually probed immutable environment.
  expect(replay.status).toBe(200);
  expect(z.object({data:EnvironmentSchema}).parse(await replay.json()).data).toEqual(initial);
  expect(initial.available).toBe(true);
},180000);
test("persists an unavailable manifest when declared release differs from execution",async()=>{
  // Given: an image whose actual TeX Live release is 2025.
  await using fixture = await environmentFixture();
  const manifest = manifestFromProbe({id:crypto.randomUUID(),label:"Incorrect declaration",report:await verifiedReport()});
  const operator = await fixture.login();
  // When: the caller falsely declares another release.
  const response = await operator.write("/api/admin/environments",{manifest:{...ManifestInputSchema.parse(manifest),release:"2099"}});
  // Then: the manifest cannot be selected for compilation.
  expect(response.status).toBe(200);
  expect(z.object({data:EnvironmentSchema}).parse(await response.json()).data.available).toBe(false);
  expect(await rejectionCode(resolveEnvironment(fixture.context,manifest.id))).toBe("ENVIRONMENT_UNAVAILABLE");
},180000);
test("rejects publication after the original operator session was revoked",async()=>{
  // Given: a real executed report and a session that was valid before the probe.
  await using fixture=await environmentFixture();
  const operator=await fixture.login();
  const report=await verifiedReport();
  const manifest=manifestFromProbe({id:crypto.randomUUID(),label:"Revoked publication",report});
  await fixture.runtime.db.run("DELETE FROM sessions WHERE id=?",[operator.actor.sessionId]);
  // When: long work attempts publication using its original authorization proof.
  const code=await rejectionCode(saveEnvironment(fixture.context,{manifest,report,actor:operator.actor}));
  // Then: current-session authorization prevents late privileged publication.
  expect(code).toBe("FORBIDDEN");
},180000);
