import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, UserSchema, endpoints } from "@quire/contracts";
import { loadConfig } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import { createApplication, modules } from "../../../apps/server/src/composition";
import { seed } from "../../../scripts/seed";
import { createUpdateClient } from "../../../services/operations/updates";
import { AuthenticatedControlCommand } from "../../../services/operations/installation/protocol";
import type { ControlCredential } from "../../../services/operations/installation/protocol";
import { clock, origin, password } from "../../core/base/harness";
import { controlFixture } from "../../operations/installation/control-fixture";

test("application composition reads authoritative receipts through the signed client without a second route registration", async () => {
  await using control = await controlFixture();
  const credential: ControlCredential = {
    id: IdSchema.parse(crypto.randomUUID()), installationId: control.store.state().installationId,
    channel: "api", secret: crypto.getRandomValues(new Uint8Array(32)),
  };
  // This read-only protocol peer exercises the accepted client contract, not
  // a supervisor, installation authority, migration helper or update execution.
  const peer = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const command = AuthenticatedControlCommand.authenticate(await request.json(), credential, clock.now()).envelope.command;
      if (command.method === "get") return Response.json(control.store.get(command.input.id));
      if (command.method === "list") return Response.json(control.store.list(command.input));
      return new Response("Read-only receipt peer", { status: 405 });
    },
  });
  try {
    const client = createUpdateClient(credential, clock, {
      async send(envelope) {
        const response = await fetch(new URL("/control", peer.url), {
          method: "POST", body: JSON.stringify(envelope), signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`Control receipt request failed: ${response.status}`);
        return response.json();
      },
    });
    const selected = new Set(["010-a-identity", "011-a-governance", "021-k-base", "042-o-tasks", "070-o-updates"]);
    const app = await createApplication({
      config: loadConfig({ QUIRE_DATA_DIR: `${control.root}/application` }),
      modules: modules.filter(module => selected.has(module.id)), adapters: false, clock,
      updates: { installationId: credential.installationId, client },
    });
    try {
      await seed(app.runtime, password);
      await app.start();
      const api = Bun.serve<RealtimeSocketData>({
        hostname: "127.0.0.1", port: 0, fetch: app.handle, websocket: app.websocket,
      });
      try {
        const login = await fetch(new URL("/api/auth/login", api.url), {
          method: "POST", headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ email: "operator@quire.local", password }),
          signal: AbortSignal.timeout(10000),
        });
        const user = z.object({ data: UserSchema }).parse(await login.json()).data;
        const cookie = login.headers.get("set-cookie")?.split(";")[0];
        if (!cookie) throw new Error("Expected operator session");
        const command = { ...control.command(), actorId: user.id };
        const receipt = control.store.accept(command, control.release, clock.now());
        const headers = { cookie, origin };
        const get = await fetch(new URL(`/api/operations/${command.operationId}`, api.url),
          { headers, signal: AbortSignal.timeout(10000) });
        expect(get.status).toBe(200);
        expect(z.object({ data: endpoints.operationGet.output }).parse(await get.json()).data).toEqual(receipt.operation);
        const list = await fetch(new URL("/api/operations?kind=update&status=queued", api.url),
          { headers, signal: AbortSignal.timeout(10000) });
        expect(list.status).toBe(200);
        expect(z.object({ data: endpoints.operationsList.output }).parse(await list.json()).data.items.map(row => row.id))
          .toEqual([command.operationId]);
        expect(await app.runtime.db.get("SELECT id FROM operations WHERE id=?", [command.operationId])).toBeNull();
      } finally { await api.stop(true); }
    } finally { await app.close(); }
  } finally { await peer.stop(true); }
});
