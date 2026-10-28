import { spawn } from "node:child_process";

export async function bounded<T>(promise: Promise<T>, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("SSH fixture event deadline exceeded")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function command(args: readonly string[], options: {
  readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly input?: string;
} = {}) {
  const child = Bun.spawn([...args], { ...options,
    stdin: options.input === undefined ? "ignore" : new Blob([options.input]), stdout: "pipe", stderr: "pipe",
    timeout: 30_000, killSignal: "SIGKILL",
  });
  const [out, error, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  console.info("SSH_COMMAND", JSON.stringify({ args, code, out, error }));
  return { out: out.trimEnd(), error, code };
}

export async function checked(args: readonly string[], options: Parameters<typeof command>[1] = {}): Promise<string> {
  const result = await command(args, options);
  if (result.code !== 0) throw new Error(`Command failed ${result.code}: ${args.join(" ")}\n${result.error}`);
  return result.out;
}

export class ServiceProcess {
  readonly child;
  readonly exited: Promise<number | null>;
  readonly ready: Promise<string>;
  output = "";
  constructor(args: readonly string[], pattern: RegExp, env = process.env) {
    this.child = spawn(args[0] ?? "", [...args.slice(1)], {
      env, stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    const ready = Promise.withResolvers<string>();
    const data = (bytes: Buffer) => {
      this.output += bytes.toString();
      const match = this.output.match(pattern);
      if (match) ready.resolve(match[0]);
    };
    this.child.stdout.on("data", data);
    this.child.stderr.on("data", data);
    this.child.once("error", error => ready.reject(error));
    this.exited = new Promise(resolve => {
      this.child.once("exit", code => {
        ready.reject(new Error(`Service exited ${code}: ${this.output}`));
        resolve(code);
      });
    });
    this.ready = bounded(ready.promise, 30_000);
  }
  async close(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null && this.child.pid !== undefined) {
      process.kill(-this.child.pid, "SIGTERM");
    }
    await bounded(this.exited);
    console.info("SSH_SERVICE_STOPPED", { pid: this.child.pid, code: this.child.exitCode, signal: this.child.signalCode,
      output: this.output });
    if (this.child.exitCode !== 0) throw new Error(`Owned service exited ${this.child.exitCode}: ${this.output}`);
  }
}
