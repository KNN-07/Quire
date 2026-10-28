import { spawn } from "node:child_process";
import { z } from "zod";
import { UserSchema } from "@quire/contracts";
import { bounded } from "../portable/process";
import { fixtureOrigin, fixturePassword } from "../../adapters/shared/harness";
import { data } from "./harness";

export class AdapterApi {
  readonly child;
  readonly exited: Promise<number | null>;
  readonly ready: Promise<string>;
  private output = "";
  constructor(env: NodeJS.ProcessEnv) {
    const ready = Promise.withResolvers<string>();
    this.child = spawn(process.execPath, [import.meta.dir + "/api-process.ts"], {
      env, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.child.stdout?.on("data", (bytes: Buffer) => { this.output += bytes.toString(); });
    this.child.stderr?.on("data", (bytes: Buffer) => { this.output += bytes.toString(); });
    this.child.on("message", (message: unknown) => {
      ready.resolve(z.object({ ready: z.url() }).parse(message).ready);
    });
    this.child.once("error", error => ready.reject(error));
    this.exited = new Promise(resolve => {
      this.child.once("exit", code => {
        ready.reject(new TypeError(`API exited ${code}: ${this.output}`));
        resolve(code);
      });
    });
    this.ready = bounded(ready.promise);
  }
  async request(path: string, input: RequestInit = {}) {
    const headers = new Headers(input.headers);
    headers.set("origin", fixtureOrigin);
    if (typeof input.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
    return fetch(new URL(path, await this.ready), { ...input, headers, signal: AbortSignal.timeout(30_000) });
  }
  async login(email = "kien@quire.local") {
    const response = await this.request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: fixturePassword }) });
    const user = await data(response, UserSchema);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Scale session cookie missing");
    const me = await data(await this.request("/api/me", { headers: { cookie } }), z.object({ csrfToken: z.string() }));
    return { user, headers: { cookie, "x-csrf-token": me.csrfToken } };
  }
  async [Symbol.asyncDispose]() {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.send("close");
    let code: number | null;
    try { code = await bounded(this.exited, 30_000); }
    catch (error) {
      this.child.kill("SIGKILL");
      await bounded(this.exited, 10_000);
      throw error;
    }
    console.info("ADAPTER_API_CLOSED", { pid: this.child.pid, code, output: this.output });
    if (code !== 0) throw new TypeError(`Adapter API cleanup exited ${code}`);
  }
}
