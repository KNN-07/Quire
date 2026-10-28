import { z } from "zod";
import { createRuntime, loadConfig, ServiceError } from "@quire/runtime";

const config = z.strictObject({ root: z.string() }).parse(JSON.parse(process.argv[2] ?? ""));
const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: config.root }));
const release = Promise.withResolvers<void>();
const pending = new Set<Promise<void>>();
process.send?.({ ready: "native" });
process.on("message", (message: unknown) => {
  const input = z.strictObject({ id: z.number(), method: z.string(), value: z.unknown() }).parse(message);
  const work = (async () => {
    switch (input.method) {
      case "write":
        await runtime.admission.writer(async () => {
          process.send?.({ signal: "writer" });
          await release.promise;
          await runtime.db.run("INSERT INTO native_process_probe(value) VALUES('other process')");
        });
        break;
      case "sql": await runtime.db.run("INSERT INTO native_process_probe(value) VALUES('new process writer')"); break;
      case "release-writer": release.resolve(); break;
      case "close":
        release.resolve();
        await Promise.all([...pending]);
        await runtime.close();
        break;
      default: throw new Error("Unknown native process command");
    }
    process.send?.({ id: input.id, result: null });
    if (input.method === "close") process.disconnect?.();
  })().catch((error: unknown) => {
    process.send?.({
      id: input.id, error: error instanceof ServiceError ? error.code : error instanceof Error ? error.message : "UNKNOWN",
    });
  });
  if (input.method !== "close") {
    pending.add(work);
    void work.then(() => pending.delete(work));
  }
});
