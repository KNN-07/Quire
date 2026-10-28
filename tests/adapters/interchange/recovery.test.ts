import { test, expect } from "bun:test";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { interchangeFixture } from "./harness";

const tex = new TextEncoder().encode("\\documentclass{article}\n\\begin{document}Receipt recovery\\end{document}");
const envelope = z.object({ data: OperationSchema });

test("returns the stored operation without another download when a previously imported URL is unavailable", async () => {
  // Given
  let requests = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {
    requests++;
    return requests === 1 ? new Response(tex, { headers: { "content-type": "text/plain" } })
      : new Response("removed", { status: 404 });
  } });
  await using fixture = await interchangeFixture({ http: new SafeHttpClient({ fixtureOrigins: [server.url.origin] }) });
  const owner = await fixture.login();
  const upload = () => fixture.request("/api/imports", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": "url-replay" },
    body: JSON.stringify({ kind: "open-in", name: "URL replay", source: { kind: "url", url: server.url.href } }) });
  try {
    const firstResponse = await upload();
    const first = envelope.parse(await firstResponse.json()).data;
    // When
    const retried = await upload();
    // Then
    expect(retried.status).toBe(202);
    expect(envelope.parse(await retried.json()).data.id).toBe(first.id);
    expect(requests).toBe(1);
  } finally { await server.stop(true); }
});

test("resumes the durable source receipt without reimporting when interruption precedes operation publication", async () => {
  // Given
  let requests = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {
    requests++;
    return new Response("removed after source publication", { status: 404 });
  } });
  await using fixture = await interchangeFixture({ http: new SafeHttpClient({ fixtureOrigins: [server.url.origin] }) });
  const owner = await fixture.login();
  const key = "source-finalized-before-operation";
  const body = { kind: "open-in", name: "Recovered import", source: { kind: "url", url: server.url.href } };
  const project = await fixture.service.createFromFiles(owner.user.id, {
    name: body.name, entries: [{ path: "main.tex", bytes: tex }],
    http: { actorId: owner.user.id, key, route: "importCreate:source",
      digest: new Bun.CryptoHasher("sha256").update(JSON.stringify(body)).digest("hex") },
  });
  await fixture.restart();
  try {
    // When
    const response = await fixture.request("/api/imports", { method: "POST",
      headers: { ...owner.headers, "idempotency-key": key }, body: JSON.stringify(body) });
    // Then
    expect(response.status).toBe(202);
    const operation = envelope.parse(await response.json()).data;
    expect(z.object({ projectIds: z.array(IdSchema) }).parse(operation.result).projectIds).toEqual([project.id]);
    expect(requests).toBe(0);
  } finally { await server.stop(true); }
});
