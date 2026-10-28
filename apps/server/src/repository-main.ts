import { z } from "zod";
import { systemClock } from "@quire/runtime";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { startRepositoryServer } from "../../../services/operations/repository";
import { PostgresBranchCoordinator } from "./scale";
import { assertUncontrolledEntrypoint } from "../../../services/operations/installation/launch";

export async function repositoryMain(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await assertUncontrolledEntrypoint(env);
  const config = z.object({
    url: z.url(), volume: z.string().min(1), token: z.string().min(32),
    host: z.string().default("127.0.0.1"), port: z.coerce.number().int().min(0).max(65535).default(0),
  }).parse({ url: env["QUIRE_POSTGRES_URL"], volume: env["QUIRE_REPOSITORY_VOLUME"],
    token: env["QUIRE_REPOSITORY_TOKEN"], host: env["QUIRE_REPOSITORY_HOST"], port: env["QUIRE_REPOSITORY_PORT"] });
  const storage = await createPostgresStorage({ url: config.url });
  const branches = new PostgresBranchCoordinator(storage.uow, systemClock);
  try {
    const server = await startRepositoryServer({ ...storage, branches, clock: systemClock,
      volume: config.volume, token: config.token, hostname: config.host, port: config.port });
    console.info("repository.listening", { url: server.url });
    const stop = Promise.withResolvers<void>();
    const signal = () => stop.resolve();
    process.once("SIGINT", signal);
    process.once("SIGTERM", signal);
    try { await stop.promise; }
    finally {
      process.off("SIGINT", signal);
      process.off("SIGTERM", signal);
      await server.close();
    }
  } finally { await branches.close(); await storage.close(); }
}
if (import.meta.main) await repositoryMain();
