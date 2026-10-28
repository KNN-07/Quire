import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { z } from "zod";

export async function bounded<T>(promise: Promise<T>, milliseconds = 120000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Integration event deadline (${milliseconds} ms)`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function command(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const child = Bun.spawn([...args], { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new Error(`${args[0]} ${args[1]} exited ${code}: ${stderr}\n${stdout}`);
  return stdout.trim();
}

export class ApiProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<number | null>;
  private readonly pending = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>();
  private sequence = 0;
  private readonly ready = Promise.withResolvers<string>();
  private readonly signals = new Map<string, ReturnType<typeof Promise.withResolvers<unknown>>>();
  private output = "";
  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [import.meta.dir + "/api-process.ts"], {
      env, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.child.stdout?.on("data", (bytes: Buffer) => { this.output += bytes.toString(); });
    this.child.stderr?.on("data", (bytes: Buffer) => { this.output += bytes.toString(); });
    this.exited = new Promise(resolve => {
      this.child.once("exit", code => {
        const error = new Error(`API exited ${code}: ${this.output}`);
        this.ready.reject(error);
        for (const waiter of this.pending.values()) waiter.reject(error);
        this.pending.clear();
        resolve(code);
      });
    });
    this.child.on("message", (message: unknown) => {
      const value = z.object({ ready: z.string().optional(), id: z.number().optional(),
        result: z.unknown().optional(), error: z.string().optional(), signal: z.string().optional() }).parse(message);
      if (value.ready) this.ready.resolve(value.ready);
      if (value.signal) this.signals.get(value.signal)?.resolve(value.result);
      if (value.id !== undefined) {
        const waiter = this.pending.get(value.id);
        this.pending.delete(value.id);
        if (value.error) waiter?.reject(new Error(value.error));
        else waiter?.resolve(value.result);
      }
    });
  }
  started(): Promise<string> { return bounded(this.ready.promise); }
  signal(name: string): Promise<unknown> {
    const waiter = Promise.withResolvers<unknown>();
    this.signals.set(name, waiter);
    return bounded(waiter.promise);
  }
  call(method: string, input: unknown = null): Promise<unknown> {
    const id = ++this.sequence;
    const waiter = Promise.withResolvers<unknown>();
    this.pending.set(id, waiter);
    this.child.send({ id, method, input });
    return bounded(waiter.promise);
  }
  async close(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) await this.call("close");
    await bounded(this.exited);
    console.info("API_PROCESS_CLEANED", { pid: this.child.pid, output: this.output });
  }
}
