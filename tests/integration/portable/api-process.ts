import { z } from "zod";
import { ScopeSchema, InstantSchema, IdSchema } from "@quire/contracts";
import type { RealtimeSocketData } from "@quire/runtime";
import { loadConfig } from "@quire/runtime";
import { createApplication } from "../../../apps/server/src/composition";
import { createScaleAdapters } from "../../../apps/server/src/scale";
import { CoreProjects } from "../../../services/core/base";

const leaseSchema = z.object({ scope: ScopeSchema, owner: z.string(), fence: z.number(), expiresAt: InstantSchema });
let crashAfterPublish = false;
let workerSourceGate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
let workerSourceHeld = false;
let workerSourceRead: Promise<void> | undefined;
const app = await createApplication({ config: loadConfig(),
  createAdapters: async (config, clock) => {
    const adapters = await createScaleAdapters(config, clock);
    const repositories = new Proxy(adapters.repositories, {
      get(target, key) {
        if (key === "publish") return async (...args: Parameters<typeof target.publish>) => {
          await target.publish(...args);
          if (crashAfterPublish) {
            process.send?.({ signal: "published" });
            await new Promise<void>(() => {});
          }
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return { ...adapters, repositories };
  },
});
await app.start();
const server = Bun.serve<RealtimeSocketData>({ hostname: "127.0.0.1", port: 0,
  fetch: (request, currentServer) => {
    if (workerSourceGate && !workerSourceHeld && /^\/internal\/jobs\/[^/]+\/source\.zip$/.test(new URL(request.url).pathname)) {
      workerSourceHeld = true;
      const read = workerSourceGate.promise.then(() => app.handle(request, currentServer));
      workerSourceRead = read.then(() => undefined, () => undefined);
      process.send?.({ signal: "worker-source-requested" });
      return read;
    }
    return app.handle(request, currentServer);
  }, websocket: app.websocket });
process.send?.({ ready: server.url.toString() });
const core = new CoreProjects({ ...app.runtime, routes: app.runtime.routes.forLane("K") });
process.on("message", (message: unknown) => {
  const value = z.object({ id: z.number(), method: z.string(), input: z.unknown() }).parse(message);
  void (async () => {
    switch (value.method) {
      case "acquire": {
        const scope = ScopeSchema.parse(value.input);
        return app.runtime.branches.acquire(scope, crypto.randomUUID(), 60000);
      }
      case "staleWrite": {
        const input = z.object({ lease: leaseSchema, actorId: IdSchema }).parse(value.input);
        const branch = await core.getBranch(input.lease.scope);
        return core.commitSource({ actorId: input.actorId, scope: input.lease.scope, lease: input.lease,
          expectedRevision: branch.revision, inputs: (await core.listFiles(input.lease.scope)).map(file => ({ file })) });
      }
      case "release": return app.runtime.branches.release(leaseSchema.parse(value.input));
      case "watch": {
        const input = z.object({ topic: z.string(), aggregateId: z.string() }).parse(value.input);
        const stop = app.runtime.events.subscribe(event => {
          if (event.topic === input.topic && event.aggregateId === input.aggregateId) {
            stop(); process.send?.({ signal: "event", result: event });
          }
        });
        return true;
      }
      case "armCrash": crashAfterPublish = true; return true;
      case "armWorkerSource":
        workerSourceGate = Promise.withResolvers<void>();
        workerSourceHeld = false;
        return true;
      case "releaseWorkerSource": workerSourceGate?.resolve(); return true;
      case "close":
        workerSourceGate?.resolve();
        await workerSourceRead;
        server[Symbol.dispose](); server.unref();
        await app.close();
        return true;
      default: throw new Error(`Unknown integration command ${value.method}`);
    }
  })().then(result => {
    process.send?.({ id: value.id, result });
    if (value.method === "close") process.disconnect?.();
  }, (error: unknown) => process.send?.({ id: value.id,
    error: error instanceof Error && "code" in error ? String(error.code) : String(error) }));
});
