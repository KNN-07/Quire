import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { z } from "zod";
import { IdSchema, ScopeSchema } from "@quire/contracts";
import { ServiceError, StorageError } from "@quire/runtime";
import { intentSchema, leaseSchema } from "./journal";
import { gitRunner, ownVolume } from "./process";
import { RepositoryEngine } from "./service";
import type { RepositoryDependencies } from "./service";
import { admissionTicketSchema } from "../storage/postgres";
import type { PostgresMutationAdmission } from "../storage/postgres";
import { RepositoryAdmission } from "./admission";

const projectSchema = z.strictObject({ projectId: IdSchema });
const argsSchema = projectSchema.extend({ args: z.array(z.string().max(8192)).min(1).max(256) });
const binarySchema = z.string().max(72 * 1024 * 1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const ttl = z.number().int().positive().max(24 * 60 * 60 * 1000);

export type RepositoryServerOptions = RepositoryDependencies & {
  readonly volume: string; readonly token: string; readonly hostname?: string; readonly port?: number;
  readonly gitCommand?: readonly string[];
  readonly admission?: PostgresMutationAdmission;
};
export type RepositoryServer = { readonly url: string; close(): Promise<void> };

export async function startRepositoryServer(options: RepositoryServerOptions): Promise<RepositoryServer> {
  if (options.db.dialect !== "postgres") throw new StorageError("REPOSITORY_POSTGRES_REQUIRED", "No SQLite fallback");
  if (Buffer.byteLength(options.token) < 32) throw new StorageError("REPOSITORY_TOKEN_REQUIRED", "Use a random secret of at least 32 bytes");
  const owner = await ownVolume(resolve(options.volume));
  const engine = new RepositoryEngine(resolve(options.volume), options, gitRunner(owner, options.gitCommand));
  const token = Buffer.from(`Bearer ${options.token}`);
  const admission = options.admission ? new RepositoryAdmission(options.admission) : undefined;
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: options.hostname ?? "127.0.0.1", port: options.port ?? 0,
      maxRequestBodySize: 73 * 1024 * 1024,
      async fetch(request) {
        const supplied = Buffer.from(request.headers.get("authorization") ?? "");
        if (supplied.length !== token.length || !timingSafeEqual(supplied, token)) {
          return Response.json({ error: { code: "REPOSITORY_UNAUTHORIZED" } }, { status: 401 });
        }
        if (request.method !== "POST") return new Response(null, { status: 405 });
        try {
          const body: unknown = await request.json();
          const path = new URL(request.url).pathname;
          const rawTicket = request.headers.get("x-quire-admission");
          const ticket = rawTicket ? admissionTicketSchema.parse(JSON.parse(rawTicket)) : undefined;
          if (path === "/v1/backup-begin" || path === "/v1/backup-end") {
            if (!admission || !ticket) throw new ServiceError("BACKUP_QUIESCENCE_REQUIRED", 409, "Repository admission is not configured");
            if (path === "/v1/backup-begin") await admission.begin(ticket);
            else await admission.end(ticket);
            return Response.json({ result: null });
          }
          const invoke = async () => {
          let result: unknown = null;
          switch (path) {
            case "/v1/restore-identity": {
              z.strictObject({}).parse(body);
              const volume = await realpath(options.volume);
              const metadata = await stat(volume, { bigint: true });
              const uid = process.getuid?.();
              if (uid === undefined || metadata.uid !== BigInt(uid) || (metadata.mode & 0o077n) !== 0n) {
                throw new StorageError("REPOSITORY_VOLUME_OWNED", "Git storage must be privately owned");
              }
              const held = await owner.stat({ bigint: true });
              const current = await stat(resolve(volume, ".repository-owner.lock"), { bigint: true });
              if (held.dev !== current.dev || held.ino !== current.ino) {
                throw new StorageError("REPOSITORY_VOLUME_OWNED", "Volume ownership changed");
              }
              result = { host: (await readFile("/etc/machine-id", "utf8")).trim(), path: volume,
                device: metadata.dev.toString(), inode: metadata.ino.toString(),
                empty: (await readdir(volume)).every(name => name === ".repository-owner.lock") };
              break;
            }
            case "/v1/initialize": await engine.initialize(projectSchema.parse(body).projectId); break;
            case "/v1/objects": {
              const input = argsSchema.extend({ input: binarySchema.optional() }).parse(body);
              result = Buffer.from(await engine.objects(input.projectId, input.args,
                input.input === undefined ? undefined : Buffer.from(input.input, "base64"))).toString("base64");
              break;
            }
            case "/v1/read": {
              const input = argsSchema.parse(body);
              result = Buffer.from(await engine.read(input.projectId, input.args)).toString("base64");
              break;
            }
            case "/v1/publish": await engine.publish(intentSchema.parse(body)); break;
            case "/v1/recover": {
              const input = z.strictObject({ id: IdSchema, lease: leaseSchema }).parse(body);
              await engine.recover(input.id, input.lease);
              break;
            }
            case "/v1/readable": await engine.assertReadable(projectSchema.parse(body).projectId); break;
            case "/v1/export": result = Buffer.from(await engine.exportNamed(projectSchema.parse(body).projectId)).toString("base64"); break;
            case "/v1/import": {
              const input = projectSchema.extend({ pack: binarySchema }).parse(body);
              await engine.importPack(input.projectId, Buffer.from(input.pack, "base64"));
              break;
            }
            case "/v1/acquire": {
              const input = z.strictObject({ scope: ScopeSchema, owner: z.string().min(1).max(256), ttlMs: ttl }).parse(body);
              result = await engine.acquire(input.scope, input.owner, input.ttlMs);
              break;
            }
            case "/v1/renew": {
              const input = z.strictObject({ lease: leaseSchema, ttlMs: ttl }).parse(body);
              result = await engine.renew(input.lease, input.ttlMs);
              break;
            }
            case "/v1/release": await engine.release(z.strictObject({ lease: leaseSchema }).parse(body).lease); break;
            default: return new Response(null, { status: 404 });
          }
          return Response.json({ result }, { headers: { "cache-control": "no-store" } });
          };
          return await (admission ? admission.run(ticket, invoke) : invoke());
        } catch (error) {
          const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
          const code = error instanceof StorageError || error instanceof ServiceError ? error.code : invalid ? "REPOSITORY_INVALID_REQUEST" : "REPOSITORY_UNAVAILABLE";
          return Response.json({ error: { code } }, { status: invalid ? 400 : 409 });
        }
      },
    });
  } catch (error) { await engine.close(); await owner.close(); throw error; }
  let closing: Promise<void> | undefined;
  return {
    url: server.url.toString(),
    close() {
      closing ??= (async () => {
        await server.stop(true);
        await admission?.close();
        await engine.close();
        await owner.close();
      })();
      return closing;
    },
  };
}
