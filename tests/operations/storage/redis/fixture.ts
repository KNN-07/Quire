import type { Subprocess } from "bun";

export async function docker(...args: string[]): Promise<string> {
  const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (exit !== 0) throw new Error(`docker ${args.join(" ")} exited ${exit}: ${stderr}`);
  return stdout.trim();
}

export function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error(`Timed out: ${label}`)); }, 10_000);
    }),
  ]).finally(() => { clearTimeout(timer); });
}

export function signal<T>() {
  const deferred = Promise.withResolvers<T>();
  return { promise: bounded(deferred.promise, "event barrier"), resolve: deferred.resolve };
}

export async function rejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(() => { throw new Error("Expected rejection, received success"); }, (error: unknown) => {
    if (!(error instanceof Error)) throw new Error("Expected Error rejection");
    return error;
  });
}

/** Each fixture owns its container, Redis process, ephemeral loopback mapping and attach child. */
export class RedisFixture {
  readonly name = `quire-p1s-redis-${crypto.randomUUID()}`;
  private child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  private drain: Promise<void> | undefined;
  url = "";

  async create(): Promise<void> {
    // Docker reallocates its own dynamic mapping on restart. Reserve an OS
    // assigned port first, then ask Docker to retain that exact mapping.
    const reservation = Bun.listen({
      hostname: "127.0.0.1", port: 0, socket: { data() {} },
    });
    const port = reservation.port;
    reservation.stop(true);
    await docker("create", "--name", this.name, "-p", `127.0.0.1:${port}:6379`,
      "redis:7.4-alpine", "redis-server", "--save", "", "--appendonly", "no");
    await this.start();
  }

  async start(): Promise<void> {
    const child = Bun.spawn(["docker", "start", "--attach", this.name],
      { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    this.child = child;
    const reader = child.stdout.getReader();
    const ready = Promise.withResolvers<void>();
    this.drain = (async () => {
      let text = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          ready.reject(new Error(`Redis exited before readiness: ${text}`));
          return;
        }
        text += new TextDecoder().decode(chunk.value);
        if (text.includes("Ready to accept connections")) ready.resolve();
      }
    })();
    void new Response(child.stderr).text();
    await bounded(ready.promise, "Redis ready log");
    const address = await docker("port", this.name, "6379/tcp");
    this.url = `redis://${address}`;
    console.log(`REDIS_READY ${this.name} ${this.url}`);
  }

  async stop(): Promise<void> {
    await docker("stop", "--time", "2", this.name);
    if (this.child) {
      const exit = await bounded(this.child.exited, "Redis attach exit");
      if (exit !== 0) throw new Error(`Redis attach exited ${exit}`);
      await this.drain;
      this.child = undefined;
    }
  }

  async close(): Promise<void> {
    await docker("rm", "--force", this.name);
    if (this.child) await bounded(this.child.exited, "Redis attach disposal");
    await this.drain;
    const remaining = await docker("ps", "--all", "--quiet", "--filter", `name=^/${this.name}$`);
    if (remaining) throw new Error(`Fixture container still exists: ${remaining}`);
    console.log(`REDIS_CLEANED ${this.name}; attach child exited; no container or listener retained`);
  }
}
