import { z } from "zod";
import { IdSchema, InstantSchema, ScopeSchema } from "@quire/contracts";
import { StorageError } from "@quire/runtime";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { RemoteBranchCoordinator, RemoteRepositoryService, startRepositoryServer } from "../../../services/operations/repository";
import { intentSchema, leaseSchema } from "../../../services/operations/repository/journal";
import { TestAuthority } from "./authority";

const config = z.object({
  role: z.enum(["server", "caller"]), database: z.string(), volume: z.string(),
  token: z.string(), url: z.string().optional(), probe: z.boolean().optional(),
}).parse(JSON.parse(process.argv[2] ?? ""));
let time = Date.parse("2026-10-27T00:00:00.000Z");
const clock = { now: () => InstantSchema.parse(new Date(time).toISOString()) };
const storage = await createPostgresStorage({ url: config.database });
const options = { url: config.url ?? "", token: config.token, clock };
const repositories = config.role === "caller" ? new RemoteRepositoryService(options) : undefined;
const branches = config.role === "caller" ? new RemoteBranchCoordinator(options) : undefined;
const server = config.role === "server" ? await startRepositoryServer({
  volume: config.volume, token: config.token, ...storage, clock, branches: new TestAuthority(storage.uow, clock),
  ...(config.probe ? { gitCommand: [process.execPath, import.meta.dir + "/git-probe.ts"] } : {}),
}) : undefined;
process.send?.({ ready: true, url: server?.url });
process.on("message", (message: unknown) => {
  const input = z.object({ id: z.number(), method: z.string(), value: z.unknown() }).parse(message);
  void (async () => {
    let result: unknown = null;
    if (input.method === "time") time = z.number().parse(input.value);
    else if (input.method === "close") {
      await repositories?.close(); await branches?.close(); await server?.close(); await storage.close();
    } else if (repositories && branches) {
      switch (input.method) {
        case "initialize": await repositories.initialize(IdSchema.parse(input.value)); break;
        case "acquire": {
          const value = z.object({ scope: ScopeSchema, owner: z.string(), ttl: z.number() }).parse(input.value);
          result = await branches.acquire(value.scope, value.owner, value.ttl); break;
        }
        case "release": await branches.release(leaseSchema.parse(input.value)); break;
        case "publish": await repositories.publish(intentSchema.parse(input.value)); break;
        case "recover": {
          const value = z.object({ id: IdSchema, lease: leaseSchema }).parse(input.value);
          await repositories.recover(value.id, value.lease); break;
        }
        case "finalize": {
          const value = z.object({ id: IdSchema, lease: leaseSchema, rollback: z.boolean().optional() }).parse(input.value);
          await storage.uow.run(async (tx) => {
            await tx.run("INSERT INTO receipts(id) VALUES(?)", [value.id]);
            await repositories.finalize(tx, value.id, value.lease);
            if (value.rollback) throw new Error("ROLLBACK_FINALIZATION");
          }); break;
        }
        case "objects":
        case "read": {
          const value = z.object({ project: IdSchema, args: z.array(z.string()), input: z.string().optional() }).parse(input.value);
          result = Buffer.from(input.method === "read" ? await repositories.read(value.project, value.args) :
            await repositories.objects(value.project, value.args, value.input === undefined ? undefined : Buffer.from(value.input, "base64"))).toString("base64");
          break;
        }
        case "export": result = Buffer.from(await repositories.exportNamed(IdSchema.parse(input.value))).toString("base64"); break;
        case "import": {
          const value = z.object({ project: IdSchema, pack: z.string() }).parse(input.value);
          await repositories.importPack(value.project, Buffer.from(value.pack, "base64")); break;
        }
        case "readable": await repositories.assertReadable(IdSchema.parse(input.value)); break;
        default: throw new Error("Unknown caller command");
      }
    } else throw new Error("Unknown server command");
    process.send?.({ id: input.id, result });
    if (input.method === "close") process.disconnect?.();
  })().catch((error: unknown) => {
    process.send?.({ id: input.id, error: error instanceof StorageError ? error.code : error instanceof Error ? error.message : "UNKNOWN" });
  });
});
