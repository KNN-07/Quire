import { join } from "node:path";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { startRepositoryServer, RemoteBranchCoordinator, RemoteRepositoryService } from "../../../services/operations/repository";
import { DiskBlobStore, LocalBranchCoordinator, SqliteEventPort, foundationMigrations, migrateDatabase } from "@quire/runtime";
import type { Clock, Migration } from "@quire/contracts";
import { checked, ServiceProcess } from "./commands";

/** Real PostgreSQL and singleton remote Git; local blob storage is explicit in this transport fixture. */
export async function remoteAdapters(root: string, clock: Clock, migrations: readonly Migration[]) {
  const name = `quire-p2o-ssh-pg-${crypto.randomUUID()}`;
  await checked(["docker", "create", "--name", name, "--label", "quire.owner=st_01a17c30",
    "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD=quire-ssh-owned", "postgres:17-alpine"]);
  const postgres = new ServiceProcess(["docker", "start", "--attach", name],
    /PostgreSQL init process complete;[\s\S]*database system is ready to accept connections/);
  const remove = async () => {
    await checked(["docker", "stop", "--timeout", "5", name]);
    await postgres.close();
    await checked(["docker", "rm", "--volumes", name]);
    console.info("SSH_CONTAINER_REMOVED", name);
  };
  try {
    await postgres.ready;
    const binding = await checked(["docker", "port", name, "5432/tcp"]);
    const storage = await createPostgresStorage({ url: `postgres://postgres:quire-ssh-owned@${binding}/postgres` });
    try {
      await migrateDatabase(storage.uow, [...await foundationMigrations(), ...migrations]);
      const volume = join(root, "canonical");
      const issuer = new LocalBranchCoordinator(storage.uow, clock, volume);
      const token = crypto.randomUUID() + crypto.randomUUID();
      const server = await startRepositoryServer({ ...storage, branches: issuer, clock, volume, token });
      const options = { url: server.url, token, clock };
      const repositories = new RemoteRepositoryService(options);
      const branches = new RemoteBranchCoordinator(options);
      const events = new SqliteEventPort(storage.db, clock);
      console.info("SSH_REMOTE_TOPOLOGY", { name, binding, repository: server.url, volume,
        authority: "postgres", blobs: "native fixture disk" });
      return {
        db: storage.db, uow: storage.uow, repositories, branches, events,
        blobs: new DiskBlobStore(join(root, "blobs")),
        async close() {
          await repositories.close(); await branches.close(); await events.close();
          await server.close(); await issuer.close(); await storage.close(); await remove();
        },
      };
    } catch (error) { await storage.close(); throw error; }
  } catch (error) { await remove(); throw error; }
}
