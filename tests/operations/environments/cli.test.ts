import { expect, test } from "bun:test";
import { z } from "zod";
import { EnvironmentSchema } from "@quire/contracts";
import { environmentFixture } from "./harness";

test("lists persisted environments through the real authenticated operator CLI",async()=>{
  // Given: a real loopback API and current operator session.
  await using fixture = await environmentFixture();
  const operator = await fixture.login();
  // When: the shipped CLI reads the operator surface over HTTP.
  const child = Bun.spawn(["bun","scripts/ops/environments.ts","list"],{
    env:{...process.env,QUIRE_OPERATOR_URL:fixture.server.url.toString(),QUIRE_OPERATOR_COOKIE:operator.headers.cookie},
    stdin:"ignore",stdout:"pipe",stderr:"pipe"});
  const timeout = setTimeout(()=>child.kill(),15000);
  try {
    const [stdout,stderr,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    // Then: its output is the shared persisted environment contract, not PATH discovery.
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const result = z.object({data:z.object({items:z.array(EnvironmentSchema)}),versions:z.string()}).parse(JSON.parse(stdout));
    expect(result.data.items.length).toBeGreaterThan(0);
  } finally {clearTimeout(timeout);await child.exited;}
},180000);
