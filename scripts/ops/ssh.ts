import { resolve } from "node:path";
import { z } from "zod";
import { assertNever } from "@quire/contracts";
import { CoreProjects } from "../../services/core/base";
import { GitRepository } from "../../services/core/git";
import { authorizedKey, forcedSession, readClient, renderSshdConfig, startSshBridge, createSshRuntime } from "../../services/operations/ssh";
import { assertUncontrolledEntrypoint } from "../../services/operations/installation/launch";

const argumentsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("serve"), file: z.string() }),
  z.object({ mode: z.literal("keys"), file: z.string(), fingerprint: z.string() }),
  z.object({ mode: z.literal("session"), file: z.string(), fingerprint: z.string() }),
  z.object({ mode: z.literal("config"), file: z.string(), hostKey: z.string(),
    port: z.coerce.number(), user: z.string(), pidFile: z.string() }),
]);

async function main(): Promise<void> {
  const [mode, file, third, fourth, fifth, sixth] = process.argv.slice(2);
  const input = argumentsSchema.parse({ mode, file, fingerprint: third, hostKey: third,
    port: fourth, user: fifth, pidFile: sixth });
  switch (input.mode) {
    case "keys": process.stdout.write(await authorizedKey(input.file, input.fingerprint)); return;
    case "session":
      process.exitCode = await forcedSession(input.file, input.fingerprint, process.env["SSH_ORIGINAL_COMMAND"] ?? "");
      return;
    case "config":
      process.stdout.write(renderSshdConfig({ user: input.user, port: input.port,
        clientFile: resolve(input.file), hostKey: resolve(input.hostKey), pidFile: resolve(input.pidFile),
        bun: process.execPath, cli: import.meta.path }));
      return;
    case "serve": {
      await assertUncontrolledEntrypoint();
      const { serveGitSession } = await import("../../services/core/git");
      const client = await readClient(input.file);
      const runtime = await createSshRuntime();
      try {
        const projects = runtime.services.get("projects");
        if (!(projects instanceof CoreProjects)) throw new TypeError("SSH needs the durable core project service");
        const port = Number(new URL(client.url).port);
        const bridge = await startSshBridge(new GitRepository(projects), {
          token: client.token, clientFile: resolve(input.file), command: [process.execPath, import.meta.path],
          port, session: serveGitSession,
        });
        const stop = Promise.withResolvers<void>();
        const finish = () => stop.resolve();
        process.once("SIGTERM", finish);
        process.once("SIGINT", finish);
        console.info(`QUIRE_SSH_READY ${bridge.url}`);
        try { await stop.promise; }
        finally {
          process.off("SIGTERM", finish);
          process.off("SIGINT", finish);
          await bridge.close();
        }
      } finally { await runtime.close(); }
      return;
    }
    default: assertNever(input);
  }
}

if (import.meta.main) {
  try { await main(); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "SSH bridge failed"}\n`);
    process.exitCode = 1;
  }
}
