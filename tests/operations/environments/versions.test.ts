import { expect, test } from "bun:test";
import { z } from "zod";
import { saveEnvironment } from "../../../services/operations/environments/registry";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { environmentFixture } from "./harness";
import { verifiedReport } from "./image";

test("rejects stale confirmation after another environment demotes the previously viewed default",async()=>{
  // Given: a viewed default and a completed change to a different real environment.
  await using fixture=await environmentFixture();
  const operator=await fixture.login();
  const report=await verifiedReport();
  const initial=manifestFromProbe({id:crypto.randomUUID(),label:"Initially viewed default",report});
  await saveEnvironment(fixture.context,{manifest:initial,report,actor:operator.actor});
  expect((await operator.write(`/api/admin/environments/${initial.id}/default`,{expectedVersion:0})).status).toBe(200);
  const viewed=await operator.get("/api/admin/environments?limit=50");
  const versions=z.record(z.string(),z.object({version:z.number(),isDefault:z.boolean()}))
    .parse(JSON.parse(z.string().parse(viewed.headers.get("x-environment-versions"))));
  const original=versions[initial.id];
  if(!original?.isDefault) throw new TypeError("Missing initial default environment");
  const manifest=manifestFromProbe({id:crypto.randomUUID(),label:"Replacement default",report});
  await saveEnvironment(fixture.context,{manifest,report,actor:operator.actor});
  const replacement=await operator.write(`/api/admin/environments/${manifest.id}/default`,{expectedVersion:0});
  expect(replacement.status).toBe(200);
  // When: confirmation still uses the demoted environment's previously viewed version.
  const stale=await operator.write(`/api/admin/environments/${initial.id}/default`,{expectedVersion:original.version});
  // Then: the implicit flag change invalidates that confirmation.
  expect(stale.status).toBe(409);
  expect(z.object({error:z.object({code:z.string()})}).parse(await stale.json()).error.code).toBe("VERSION_CONFLICT");
},180000);
