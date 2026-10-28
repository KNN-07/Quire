import { readFile } from "node:fs/promises";
import { z } from "zod";
import { assertNever } from "@quire/contracts";
import { loadConfig } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import type { Server } from "bun";
import { createApplication, modules } from "../../../apps/server/src/composition";
import { CompilerService } from "../../../services/compiler";

const ticks = new Set<() => void>();
let app: Awaited<ReturnType<typeof createApplication>> | undefined;
let server: Server<RealtimeSocketData> | undefined;
let events = 0;
let tail = Promise.resolve();
const send = (message: unknown) => {
  if (!process.send) throw new Error("Owned fixture IPC required");
  process.send(message);
};
const command = z.object({ id: z.number(), method: z.enum(["prepare", "status", "activate", "tick", "dispose"]) });
async function handle(input: z.infer<typeof command>) {
  switch (input.method) {
    case "prepare":
      app = await createApplication({
        config: loadConfig(), startup: "prepared",
        modules: [...modules, { id: "009-f-event-proof", lane: "F", order: 0, register(context) {
          context.events.subscribe(() => { events++; });
        } }],
        adapters: { schedulerTicks: { subscribe(listener) {
          ticks.add(listener);
          return () => { ticks.delete(listener); };
        } } },
      });
      server = Bun.serve<RealtimeSocketData>({ hostname: "127.0.0.1", port: 0, fetch: app.handle, websocket: app.websocket });
      return { url: server.url.href, readiness: await app.check() };
    case "status": {
      if (!app) throw new Error("Prepare first");
      let writable = false;
      let reaper = false;
      try {
        const compiler = app.runtime.services.get("compiler");
        writable = true;
        reaper = compiler instanceof CompilerService && compiler.leaseTimer !== null;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "APPLICATION_NOT_ACTIVE") throw error;
      }
      return { state: app.state, writable, reaper, subscriptions: ticks.size, events,
        children: (await readFile(`/proc/self/task/${process.pid}/children`, "utf8")).trim() };
    }
    case "activate":
      if (!app) throw new Error("Prepare first");
      await Promise.all([app.start(), app.activate(), app.start()]);
      return { state: app.state };
    case "tick":
      for (const tick of ticks) tick();
      return { subscriptions: ticks.size };
    case "dispose":
      if (!app || !server) throw new Error("Prepare first");
      await app.dispose();
      await server.stop(true);
      return { state: app.state, subscriptions: ticks.size };
    default: return assertNever(input.method);
  }
}
process.on("message", (raw: unknown) => {
  const input = command.parse(raw);
  tail = tail.then(async () => {
    try { send({ id: input.id, result: await handle(input) }); }
    catch (error) {
      send({ id: input.id, error: error instanceof Error ? error.stack : String(error) });
      process.exitCode = 1;
    }
    if (input.method === "dispose") {
      if (!process.disconnect) throw new Error("Owned fixture IPC required");
      process.disconnect();
    }
  });
});
send({ ready: true });
