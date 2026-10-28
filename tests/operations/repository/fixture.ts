import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { IdSchema, GitOidSchema } from "@quire/contracts";
import type { GitOid, Id } from "@quire/contracts";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";

export async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Repository fixture event deadline")), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

export class Worker {
  private sequence = 0;
  private readonly pending = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>();
  private readonly ready = Promise.withResolvers<string>();
  private errors = "";
  readonly child;
  readonly exited: Promise<number | null>;
  constructor(config: Record<string, unknown>) {
    this.child = spawn(process.execPath, [import.meta.dir + "/worker.ts", JSON.stringify(config)], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    this.child.stderr?.on("data", (chunk: Buffer) => { this.errors += chunk.toString(); });
    this.exited = new Promise((resolve) => {
      this.child.once("exit", (code) => {
        const error = new Error(`Worker exited ${code}: ${this.errors}`);
        this.ready.reject(error);
        for (const waiter of this.pending.values()) waiter.reject(error);
        this.pending.clear();
        resolve(code);
      });
    });
    this.child.on("message", (message: unknown) => {
      const value = z.object({
        ready: z.boolean().optional(), url: z.string().optional(), id: z.number().optional(),
        result: z.unknown().optional(), error: z.string().optional(),
      }).parse(message);
      if (value.ready) this.ready.resolve(value.url ?? "");
      else if (value.id !== undefined) {
        const waiter = this.pending.get(value.id);
        this.pending.delete(value.id);
        if (value.error) waiter?.reject(new Error(value.error));
        else waiter?.resolve(value.result);
      }
    });
  }
  started(): Promise<string> { return bounded(this.ready.promise); }
  async call(method: string, value: unknown = null): Promise<unknown> {
    const id = ++this.sequence;
    const waiter = Promise.withResolvers<unknown>();
    this.pending.set(id, waiter);
    this.child.send({ id, method, value });
    return bounded(waiter.promise);
  }
  async close(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) await this.call("close");
    await bounded(this.exited);
  }
}

export async function fixture(probe = false) {
  const url = process.env["QUIRE_TEST_POSTGRES_URL"];
  if (!url) throw new Error("QUIRE_TEST_POSTGRES_URL is required; no fallback");
  const admin = await createPostgresStorage({ url });
  const name = `quire_repository_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.db.exec(`CREATE DATABASE "${name}"`);
  const database = new URL(url);
  database.pathname = `/${name}`;
  const storage = await createPostgresStorage({ url: database.toString() });
  await storage.db.exec(`
    CREATE TABLE branch_leases(project_id TEXT NOT NULL,branch TEXT NOT NULL,owner TEXT NOT NULL,
      fence BIGINT NOT NULL CHECK(fence>0),expires_at TEXT NOT NULL,PRIMARY KEY(project_id,branch));
    CREATE TABLE repository_intents(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,branch TEXT NOT NULL,
      owner TEXT NOT NULL,fence BIGINT NOT NULL,updates_json TEXT NOT NULL,state TEXT NOT NULL
      CHECK(state IN ('prepared','published','finalized','conflicted')),created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX repository_pending ON repository_intents(project_id) WHERE state<>'finalized';
    CREATE TABLE receipts(id TEXT PRIMARY KEY);
  `);
  const volume = await mkdtemp(join(tmpdir(), "quire-p1s-repository-"));
  const token = crypto.randomUUID() + crypto.randomUUID();
  const config = { role: "server", database: database.toString(), volume, token, probe };
  const sockets = new Set<Socket>();
  let gate: ReturnType<typeof Promise.withResolvers<Socket>> | undefined;
  const listener = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.once("data", (bytes: Buffer) => {
      const value = z.object({ args: z.array(z.string()) }).parse(JSON.parse(bytes.toString()));
      if (gate && value.args.includes("update-ref")) {
        const current = gate; gate = undefined; current.resolve(socket);
      } else socket.write("run\n");
    });
  });
  const listening = once(listener, "listening");
  listener.listen(join(volume, ".probe.sock"));
  await listening;
  let server = new Worker(config);
  const endpoint = await server.started();
  const callerConfig = { ...config, role: "caller", url: endpoint };
  const first = new Worker(callerConfig);
  const second = new Worker(callerConfig);
  await Promise.all([first.started(), second.started()]);
  return {
    ...storage, volume, endpoint, token, first, second, config,
    pauseCas() { gate = Promise.withResolvers<Socket>(); return bounded(gate.promise); },
    serverTime(value: number) { return server.call("time", value); },
    async time(value: number) { await Promise.all([server.call("time", value), first.call("time", value), second.call("time", value)]); },
    async restart() {
      await first.close(); await second.close(); await server.close();
      server = new Worker(config);
      const restartedUrl = await server.started();
      return restartedUrl;
    },
    async close() {
      for (const socket of sockets) socket.end("run\n");
      await Promise.all([first.close(), second.close()]);
      await server.close();
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
      await storage.close();
      await admin.db.exec(`DROP DATABASE "${name}"`);
      await admin.close();
      await rm(volume, { recursive: true, force: true });
      console.log(`CLEANED ${volume} database=${name} callers/service/listener exited`);
    },
  };
}

export const id = (): Id => IdSchema.parse(crypto.randomUUID());
export const text = (value: unknown): string => Buffer.from(z.string().parse(value), "base64").toString().trim();
export async function commit(worker: Worker, project: Id, message: string): Promise<GitOid> {
  const tree = text(await worker.call("objects", { project, args: ["mktree"], input: "" }));
  return GitOidSchema.parse(`sha1:${text(await worker.call("objects", { project, args: ["commit-tree", tree, "-m", message] }))}`);
}
