import { expect, test } from "bun:test";
import { rejects, throws } from "node:assert/strict";
import { spawn } from "node:child_process";
import { z } from "zod";
import { createApplication, modules } from "../../../apps/server/src/composition";
import { createRuntime } from "@quire/runtime";
import type { Runtime, ServiceModule } from "@quire/runtime";
import { CompilerService } from "../../../services/compiler";
import { SecretBox } from "../../../services/adapters/shared/secrets";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { SmtpFixture } from "../../adapters/delivery/smtp-fixture";
import { fixtureCertificate } from "../../adapters/delivery/tls-material";
import { fixtureIds } from "../../fixtures/foundation";
import { bounded } from "../portable/process";
import { fixture, fingerprint, inspect, password } from "./fixture";

class PreparedProcess {
  private readonly pending = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>();
  private readonly ready = Promise.withResolvers<void>();
  private sequence = 0;
  private output = "";
  readonly child;
  readonly exited: Promise<number | null>;
  constructor(root: string) {
    this.child = spawn(process.execPath, [joinChild()], {
      env: { ...process.env, QUIRE_DATA_DIR: root, QUIRE_COMPILER_BACKEND: "docker",
        QUIRE_PUBLIC_URL: "http://prepared.test", NODE_ENV: "test", QUIRE_PROFILE: "local" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    if (!this.child.stdout || !this.child.stderr) throw new Error("Owned child output pipes required");
    this.child.stdout.on("data", (data: Buffer) => { this.output += data.toString(); });
    this.child.stderr.on("data", (data: Buffer) => { this.output += data.toString(); });
    this.child.on("message", (raw: unknown) => {
      const message = z.object({ ready: z.boolean().optional(), id: z.number().optional(),
        result: z.unknown().optional(), error: z.string().optional() }).parse(raw);
      if (message.ready) this.ready.resolve();
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (!waiter) throw new Error("Unexpected child response");
        if (message.error) waiter.reject(new Error(message.error));
        else waiter.resolve(message.result);
      }
    });
    this.exited = new Promise(resolve => {
      this.child.once("exit", code => {
        const failure = new Error(`Prepared child exited ${code}: ${this.output}`);
        this.ready.reject(failure);
        for (const waiter of this.pending.values()) waiter.reject(failure);
        resolve(code);
      });
    });
  }
  async call(method: "prepare" | "status" | "activate" | "tick" | "dispose") {
    await bounded(this.ready.promise);
    const id = ++this.sequence;
    const waiter = Promise.withResolvers<unknown>();
    this.pending.set(id, waiter);
    this.child.send({ id, method });
    return bounded(waiter.promise);
  }
  async close() {
    if (this.child.exitCode === null && this.child.signalCode === null) await this.call("dispose");
    expect(await bounded(this.exited)).toBe(0);
    console.info("P7_CHILD_CLEANED", { pid: this.child.pid, output: this.output });
  }
}
function joinChild() { return import.meta.dir + "/application-child.ts"; }

test("real prepared application process denies HTTP, SSE, Git, worker and WebSocket ingress then activates and drains SMTP", async () => {
  const smtp = new SmtpFixture();
  await smtp.start();
  try {
    await using data = await fixture({}, true);
    const setup = await createApplication({ config: data.config });
    const mailId = crypto.randomUUID();
    try {
      await setup.runtime.db.run("DELETE FROM adapter_provider_configs WHERE kind='localMail'");
      const encrypted = new SecretBox(setup.runtime.secretKey).seal(JSON.stringify({
        username: "fixture-user", password: "fixture-password", from: "no-reply@quire.local",
        ehloName: "quire.local", ca: fixtureCertificate,
      }), "provider:smtp");
      await setup.runtime.uow.run(async tx => {
        await tx.run(`INSERT INTO adapter_provider_configs(id,kind,base_url,model,encrypted_secret,policy_json,enabled,version,updated_at)
          VALUES(?,'smtp',?,'implicit',?,?,1,1,?)`, [crypto.randomUUID(), `https://127.0.0.1:${smtp.port}`,
          encrypted, JSON.stringify(defaultPolicy), setup.runtime.clock.now()]);
        await tx.run(`INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,status,created_at)
          VALUES(?,'reader@example.test','Prepared lifecycle','Retained body',?,'local',?)`,
        [mailId, mailId, setup.runtime.clock.now()]);
        await setup.runtime.events.record(tx, { topic: "policy.changed", aggregateId: fixtureIds.project,
          payload: { resourceId: fixtureIds.project, version: 1 } });
      });
    } finally { await setup.close(); }
    const before = await fingerprint(data.root);
    const child = new PreparedProcess(data.root);
    try {
      const prepared = z.object({ url: z.url(), readiness: z.object({ database: z.literal("sqlite") }) })
        .parse(await child.call("prepare"));
      const status = await child.call("status");
      expect(status).toEqual({ state: "prepared", writable: false, reaper: false, subscriptions: 0, events: 0, children: "" });
      for (const path of ["/api/health", "/api/events", "/api/projects", "/git/project.git/info/refs", "/api/internal/workers/claim"]) {
        const response = await fetch(new URL(path, prepared.url), { signal: AbortSignal.timeout(10_000) });
        expect(response.status).toBe(503);
      }
      const websocket = await fetch(new URL("/api/realtime", prepared.url), {
        headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "sec-websocket-version": "13" }, signal: AbortSignal.timeout(10_000),
      });
      expect(websocket.status).toBe(503);
      await child.call("tick");
      expect(smtp.commands).toEqual([]);
      expect(await fingerprint(data.root)).toEqual(before);
      expect(await child.call("activate")).toEqual({ state: "active" });
      const active = z.object({ state: z.literal("active"), writable: z.literal(true), reaper: z.literal(true),
        subscriptions: z.literal(3), events: z.number().positive() }).parse(await child.call("status"));
      expect(active.events).toBeGreaterThan(0);
      expect((await fetch(new URL("/api/health", prepared.url))).status).toBe(200);
      const login = await fetch(new URL("/api/auth/login", prepared.url), { method: "POST",
        headers: { "content-type": "application/json", origin: "http://prepared.test" },
        body: JSON.stringify({ email: "kien@quire.local", password }), signal: AbortSignal.timeout(10_000) });
      expect(login.status).toBe(200);
      const accepted = smtp.nextMessage();
      await child.call("tick");
      expect(await child.call("dispose")).toEqual({ state: "disposed", subscriptions: 0 });
      expect((await accepted).messageId).toContain(mailId);
      expect(await bounded(child.exited)).toBe(0);
      using db = inspect(data.root);
      expect(db.query("SELECT state FROM adapter_mail_deliveries WHERE outbox_id=?").get(mailId)).toEqual({ state: "sent" });
      expect(db.query("SELECT kind FROM adapter_provider_configs WHERE kind='localMail'").get()).toEqual({ kind: "localMail" });
    } finally { await child.close(); }
  } finally { await smtp.close(); }
}, 120000);

test("direct prepared getters and callbacks are closed, including disposal before activation", async () => {
  await using data = await fixture({}, true);
  const before = await fingerprint(data.root);
  const app = await data.prepare();
  throws(() => app.runtime, { code: "APPLICATION_NOT_ACTIVE" });
  throws(() => app.adapters, { code: "APPLICATION_NOT_ACTIVE" });
  throws(() => Reflect.apply(app.websocket.message, undefined, [null, "ordinary message"]), { code: "APPLICATION_NOT_ACTIVE" });
  expect((await app.fetch(new Request("http://prepared.test/api/health"))).status).toBe(503);
  await app.dispose();
  await app.close();
  await rejects(app.start(), { code: "RUNTIME_DISPOSED" });
  await rejects(app.check(), { code: "APPLICATION_NOT_ACTIVE" });
  expect(await fingerprint(data.root)).toEqual(before);
}, 120000);

test("default construction remains eager and module replacement/adapters:false install no extra schedulers", async () => {
  const listeners = new Set<() => void>();
  const deployment = { schedulerTicks: { subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  } } };
  await using data = await fixture({ adapters: deployment });
  const eager = await createApplication({ config: data.config, adapters: deployment });
  expect(eager.runtime.services.has("compiler")).toBe(true);
  expect(eager.runtime.services.has("adapters")).toBe(true);
  expect(listeners.size).toBe(0);
  await Promise.all([eager.start(), eager.start()]);
  expect(listeners.size).toBe(3);
  await eager.close();
  expect(listeners.size).toBe(0);
  await using custom = await fixture({ modules: [], adapters: false });
  const replaced = await createApplication({ config: custom.config, modules: [] });
  try {
    expect(replaced.adapters).toBeUndefined();
    expect(replaced.runtime.services.has("compiler")).toBe(false);
    expect((await replaced.fetch(new Request("http://prepared.test/api/connections/availability"))).status).toBe(501);
  } finally { await replaced.close(); }
  const disabled = await createApplication({ config: data.config, adapters: false });
  try {
    expect(disabled.adapters).toBeUndefined();
    expect(disabled.runtime.services.has("adapters")).toBe(false);
  } finally { await disabled.close(); }
});

test("a failed real aggregate activation removes partial subscriptions and closes storage", async () => {
  await using data = await fixture();
  const listeners = new Set<() => void>();
  let subscribed = 0;
  const app = await createApplication({ config: data.config, startup: "prepared",
    adapters: { schedulerTicks: { subscribe(listener) {
      if (++subscribed === 2) throw new Error("owned scheduler activation failure");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    } } },
  });
  await rejects(app.start(), /owned scheduler activation failure/);
  expect(app.state).toBe("failed");
  expect(listeners.size).toBe(0);
  throws(() => app.runtime, { code: "APPLICATION_NOT_ACTIVE" });
  await app.dispose();
  const reopen = await createRuntime(data.config);
  await reopen.close();
});

test("failed registration drains its real child, compiler reaper and cleanup SQL before closing storage", async () => {
  await using data = await fixture();
  let child: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">> | undefined;
  let compiler: CompilerService | undefined;
  let captured: Pick<Runtime, "db"> | undefined;
  let releases = 0;
  const resource: ServiceModule = {
    id: "099-f-owned-process", lane: "F", order: 99,
    async register(context) {
      captured = context;
      const service = context.services.get("compiler");
      if (!(service instanceof CompilerService)) throw new Error("Actual compiler required");
      compiler = service;
      child = Bun.spawn(["/bin/sh", "-c", "printf 'OWNED_READY\\n'; read -r command; test \"$command\" = stop"],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      const reader = child.stdout.getReader();
      try {
        const ready = await bounded(reader.read());
        expect(new TextDecoder().decode(ready.value)).toBe("OWNED_READY\n");
      } finally { reader.releaseLock(); }
      throw new Error("owned registration failure");
    },
    async dispose(context) {
      releases++;
      if (!child) throw new Error("Owned child was not created");
      await child.stdin.write("stop\n");
      await child.stdin.end();
      expect(await bounded(child.exited)).toBe(0);
      await context.db.run("INSERT INTO operator_settings(key,value_json,updated_at) VALUES('child-drained','true',?)",
        [context.clock.now()]);
    },
  };
  const app = await createApplication({ config: data.config, startup: "prepared",
    modules: [...modules, resource], adapters: {} });
  expect(child).toBeUndefined();
  await rejects(app.activate(), /owned registration failure/);
  expect(releases).toBe(1);
  if (!compiler || !captured) throw new Error("Real resources never registered");
  expect(compiler.leaseTimer).toBeNull();
  expect(compiler.active.size).toBe(0);
  expect(compiler.pending.size).toBe(0);
  await rejects(captured.db.get("SELECT 1"), { code: "DATABASE_CLOSED" });
  await app.dispose();
  expect(releases).toBe(1);
  using db = inspect(data.root);
  expect(db.query("SELECT value_json FROM operator_settings WHERE key='child-drained'").get()).toEqual({ value_json: "true" });
});

test("detached compiler SQL failures are retained while application disposal still drains and closes storage", async () => {
  await using data = await fixture();
  const app = await data.prepare();
  await app.activate();
  const runtime = app.runtime;
  const compiler = runtime.services.get("compiler");
  if (!(compiler instanceof CompilerService)) throw new Error("Actual compiler required");
  compiler.runBackground(runtime.db.run("INSERT INTO p7_missing_table(id) VALUES(1)").then(() => undefined));
  await Promise.allSettled([...compiler.pending]);
  await rejects(app.dispose(), error => error instanceof AggregateError);
  expect(compiler.leaseTimer).toBeNull();
  expect(compiler.pending.size).toBe(0);
  await rejects(runtime.db.get("SELECT 1"), { code: "DATABASE_CLOSED" });
});
