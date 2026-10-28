import { z } from "zod";
import { createPrivateKey } from "node:crypto";
import { loadConfig } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import type { Server } from "bun";
import { createApplication } from "../../../apps/server/src/composition";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { seed } from "../../../scripts/seed";
import { fixturePassword } from "../../adapters/shared/harness";
import { fixtureIds } from "../../fixtures/foundation";

const origins = z.array(z.url()).parse(JSON.parse(process.env["QUIRE_TEST_FIXTURE_ORIGINS"] ?? "[]"));
const http = new SafeHttpClient({ fixtureOrigins: origins, timeoutMs: 20_000 });
const app = await createApplication({
  config: loadConfig(),
  adapters: { http, ai: { http }, federation: { organizationId: fixtureIds.institution } },
  backups: { signingKey: createPrivateKey(z.string().min(1).parse(process.env["QUIRE_BACKUP_SIGNING_FIXTURE_PEM"])) },
});
let server: Server<RealtimeSocketData> | undefined;
let closing: Promise<void> | undefined;
function close() {
  closing ??= (async () => {
    await server?.stop(true);
    await app.close();
    process.disconnect?.();
  })();
  return closing;
}
try {
  if (process.env["QUIRE_TEST_SEED"] === "1") await seed(app.runtime, fixturePassword);
  await app.start();
  server = Bun.serve<RealtimeSocketData>({ hostname: "127.0.0.1", port: 0, fetch: app.handle, websocket: app.websocket });
  process.send?.({ ready: server.url.toString() });
} catch (error) { await close(); throw error; }
process.on("message", (message: unknown) => {
  const command = z.literal("close").parse(message);
  if (command === "close") void close().catch((error: unknown) => {
    console.error(error); process.exitCode = 1; process.disconnect?.();
  });
});
process.on("SIGTERM", () => { void close().catch((error: unknown) => { console.error(error); process.exitCode = 1; }); });
