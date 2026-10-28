import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { z } from "zod";
import { bounded } from "../portable/process";
import { S3TestServer } from "../../operations/storage/s3/server";
import { loadBackupSigner } from "../../../services/operations/backups";

export class AdmissionProcess {
  private sequence = 0;
  private readonly pending = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>();
  private readonly signals = new Map<string, ReturnType<typeof Promise.withResolvers<unknown>>>();
  private readonly ready = Promise.withResolvers<string>();
  private output = "";
  readonly child;
  readonly exited: Promise<number | null>;
  constructor(config: Readonly<Record<string, unknown>>, script = join(import.meta.dir, "process.ts")) {
    this.child = spawn(process.execPath, [script, JSON.stringify(config)], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    this.child.stderr?.on("data", (bytes: Buffer) => { this.output += bytes.toString(); });
    this.exited = new Promise(resolve => this.child.once("exit", code => {
      const failure = new Error(`Admission process exited ${code}: ${this.output}`);
      if (code !== 0) console.error("ADMISSION_PROCESS_EXIT_FAILED", { pid: this.child.pid, code, output: this.output });
      this.ready.reject(failure);
      for (const pending of this.pending.values()) pending.reject(failure);
      resolve(code);
    }));
    this.child.on("message", (message: unknown) => {
      const value = z.object({
        ready: z.string().optional(), id: z.number().optional(), result: z.unknown().optional(),
        error: z.string().optional(), signal: z.string().optional(), value: z.unknown().optional(),
      }).parse(message);
      if (value.ready) this.ready.resolve(value.ready);
      if (value.signal === "close-phase") this.output += `shutdown ${String(value.value)}\n`;
      if (value.signal) this.signals.get(value.signal)?.resolve(value.value);
      if (value.id !== undefined) {
        const pending = this.pending.get(value.id);
        this.pending.delete(value.id);
        if (value.error) pending?.reject(new Error(value.error));
        else pending?.resolve(value.result);
      }
    });
  }
  started(): Promise<string> { return bounded(this.ready.promise, 30000); }
  signal(name: string): Promise<unknown> {
    const value = Promise.withResolvers<unknown>();
    this.signals.set(name, value);
    return bounded(value.promise, 30000);
  }
  call(method: string, value: unknown = null): Promise<unknown> {
    if (!this.child.connected) return Promise.reject(new Error(`Admission IPC closed: ${this.output}`));
    const id = ++this.sequence;
    const result = Promise.withResolvers<unknown>();
    this.pending.set(id, result);
    this.child.send({ id, method, value });
    return bounded(result.promise, 30000);
  }
  async close(): Promise<void> {
    for (const signal of this.signals.values()) signal.resolve(null);
    this.child.kill("SIGCONT");
    if (this.child.connected) {
      try { await this.call("close"); }
      catch (error) {
        this.child.kill("SIGTERM");
        await bounded(this.exited, 30000);
        throw error;
      }
    }
    const code = await bounded(this.exited, 30000);
    if (code !== 0) throw new Error(`Admission process cleanup failed: ${this.output}`);
  }
}

export async function scaleFixture() {
  const url = process.env["QUIRE_TEST_POSTGRES_URL"];
  if (!url) throw new Error("QUIRE_TEST_POSTGRES_URL is required");
  const redis = process.env["QUIRE_TEST_REDIS_URL"];
  if (!redis) throw new Error("QUIRE_TEST_REDIS_URL is required");
  const s3 = new S3TestServer();
  await s3.create();
  const admin = new SQL(url, { max: 2 });
  const name = `quire_admission_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const database = new URL(url);
  database.pathname = `/${name}`;
  const observer = new SQL(database.toString(), { max: 2 });
  const root = await mkdtemp(join(tmpdir(), "quire-backup-admission-scale-"));
  await mkdir(join(root, "blobs"));
  await mkdir(join(root, "git"));
  const signer = join(root, "backup-signing.pem");
  await loadBackupSigner(signer, true);
  const backupRoot = join(root, "archives");
  await mkdir(backupRoot, { mode: 0o700 });
  const token = crypto.randomUUID() + crypto.randomUUID();
  const sockets = new Set<Socket>();
  let barrier: { readonly command: string; readonly entered: ReturnType<typeof Promise.withResolvers<Socket>> } | undefined;
  const listener = createServer(socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.once("data", (bytes: Buffer) => {
      const probe = z.object({ args: z.array(z.string()) }).parse(JSON.parse(bytes.toString()));
      if (barrier && probe.args.includes(barrier.command)) {
        barrier.entered.resolve(socket);
        barrier = undefined;
      } else socket.write("run\n");
    });
  });
  const listening = once(listener, "listening");
  listener.listen(join(root, "git", ".probe.sock"));
  await listening;
  const processes: AdmissionProcess[] = [];
  const close = async () => {
    for (const socket of sockets) socket.end("run\n");
    const failures: unknown[] = [];
    for (const process of [...processes].reverse()) {
      try { await process.close(); }
      catch (error) {
        console.error("ADMISSION_PROCESS_CLEANUP_FAILED", { pid: process.child.pid, error });
        failures.push(error);
      }
    }
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    await observer.close();
    await admin.unsafe(`DROP DATABASE "${name}"`);
    await admin.close();
    await s3.remove();
    await rm(root, { recursive: true, force: true });
    console.info("ADMISSION_SCALE_CLEANED", { root, database: name, processes: processes.map(process => process.child.pid) });
    if (failures.length) throw new AggregateError(failures, "Admission process teardown failed");
  };
  try {
  const shared = { database: database.toString(), token, redis, namespace: name, signer, backupRoot, s3: s3.options() };
  const repository = new AdmissionProcess({ ...shared, role: "repository", root });
  processes.push(repository);
  const repositoryUrl = await repository.started();
  const first = new AdmissionProcess({ ...shared, role: "api", root: join(root, "first"), url: repositoryUrl });
  processes.push(first);
  const firstUrl = await first.started();
  await first.call("seed");
  const second = new AdmissionProcess({ ...shared, role: "api", root: join(root, "second"), url: repositoryUrl });
  processes.push(second);
  const secondUrl = await second.started();
  return {
    first, second, firstUrl, secondUrl, repository, observer, root, backupRoot,
    pause(command: string) {
      const entered = Promise.withResolvers<Socket>();
      barrier = { command, entered };
      return bounded(entered.promise, 30000);
    },
    [Symbol.asyncDispose]: close,
  };
  } catch (error) { await close(); throw error; }
}
