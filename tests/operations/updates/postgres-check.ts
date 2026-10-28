import assert from "node:assert/strict";
import { z } from "zod";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { foundationMigrations, migrateDatabase } from "@quire/runtime";
import { migrations, reserveUpdateCommand } from "../../../services/operations/updates";
import { fixture, id } from "./fixture";

async function command(args: readonly string[]): Promise<string> {
  const child = Bun.spawn([...args], { stdout: "pipe", stderr: "pipe" });
  const [exit, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exit !== 0) throw new Error(`${args[0]} exited ${exit}: ${error}`);
  return output.trim();
}

/** Creates/removes only this invocation's named disposable container; no pull. */
export async function postgresFixture() {
  const name = `quire-update-keys-${crypto.randomUUID()}`;
  const password = crypto.randomUUID();
  await command(["docker", "run", "--detach", "--name", name, "--label", `quire.update-test=${name}`,
    "--env", `POSTGRES_PASSWORD=${password}`, "--publish", "127.0.0.1::5432", "--pull=never", "postgres:17-alpine"]);
  try {
    const logs = Bun.spawn(["docker", "logs", "--follow", name], { stdout: "pipe", stderr: "pipe" });
    const ready = Promise.withResolvers<void>();
    const controller = new AbortController();
    async function observe(stream: ReadableStream<Uint8Array>) {
      let text = "";
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          text += decoder.decode(value, { stream: true });
          if (/\[1\] LOG:\s+database system is ready to accept connections/.test(text)) ready.resolve();
        }
      } finally { reader.releaseLock(); }
    }
    const readers = [observe(logs.stdout), observe(logs.stderr)];
    const onTimeout = () => ready.reject(new Error("Owned PostgreSQL did not emit its final PID 1 readiness event"));
    const deadline = setTimeout(onTimeout, 30_000);
    void logs.exited.then(code => { if (!controller.signal.aborted) ready.reject(new Error(`Docker log stream exited ${code} before readiness`)); });
    try { await ready.promise; }
    finally {
      clearTimeout(deadline);
      controller.abort();
      logs.kill();
      await logs.exited;
      await Promise.all(readers);
    }
    const inspection = z.array(z.object({
      NetworkSettings: z.object({ Ports: z.record(z.string(), z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).nullable()) }),
    })).parse(JSON.parse(await command(["docker", "inspect", name])));
    const port = inspection[0]?.NetworkSettings.Ports["5432/tcp"]?.find(binding => binding.HostIp === "127.0.0.1")?.HostPort;
    if (port === undefined) throw new Error("Owned PostgreSQL loopback mapping is absent");
    return {
      url: `postgres://postgres:${password}@127.0.0.1:${port}/postgres`,
      async [Symbol.asyncDispose]() {
        await command(["docker", "rm", "--force", name]);
        console.log(`CLEANED owned PostgreSQL container ${name}`);
      },
    };
  } catch (error) {
    await command(["docker", "rm", "--force", name]);
    throw error;
  }
}

/** Run only against an explicitly owned disposable PostgreSQL server. */
export async function checkPostgres(url: string): Promise<void> {
  const admin = await createPostgresStorage({ url });
  const database = `quire_updates_${crypto.randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(url);
  databaseUrl.pathname = `/${database}`;
  await admin.db.exec(`CREATE DATABASE "${database}"`);
  try {
    const storage = await createPostgresStorage({ url: databaseUrl.href });
    try {
      await migrateDatabase(storage.uow, [...await foundationMigrations(), ...migrations]);
      await using f = await fixture();
      await storage.db.run("INSERT INTO users(id,name,primary_email,operator,created_at,updated_at) VALUES(?,?,?,1,?,?)",
        [f.actorId, "Operator", "updates@fixture.invalid", f.clock.now(), f.clock.now()]);
      const release = (await f.service.releases())[0];
      assert(release);
      const request = { releaseId: release.id, at: f.clock.now(), autoSecurity: true };
      const reserve = (key: string) => reserveUpdateCommand(storage.uow, f.config.installId, f.actorId, key, request);
      const first = await reserve("update-first");
      assert.deepEqual(await reserve(first.key), first);
      const insert = (key: string) => storage.db.run(`INSERT INTO operations
        (id,actor_id,kind,status,idempotency_key,created_at,updated_at) VALUES(?,?,'adapter','queued',?,?,?)`,
      [id(), f.actorId, key, f.clock.now(), f.clock.now()]);
      await assert.rejects(insert(first.key), /IDEMPOTENCY_CONFLICT/);
      await insert("adapter-first");
      await assert.rejects(reserve("adapter-first"), { code: "IDEMPOTENCY_CONFLICT" });
      await insert("movable");
      await assert.rejects(storage.db.run(
        "UPDATE operations SET idempotency_key=? WHERE actor_id=? AND idempotency_key='movable'", [first.key, f.actorId],
      ), /IDEMPOTENCY_CONFLICT/);
      const raced = await Promise.allSettled([insert("concurrent"), reserve("concurrent")]);
      assert.equal(raced.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(raced.filter(result => result.status === "rejected").length, 1);
      const queued = await f.service.create(first);
      await f.service.tick();
      assert.equal((await f.service.store.operation(queued.id)).status, "succeeded");
      f.rejectFeed();
      await f.reopenControl();
      assert.equal((await f.service.create(await reserve(first.key))).id, queued.id);
      assert.deepEqual([...await storage.db.all("SELECT * FROM operations WHERE kind='update'")], []);
      console.log(`PASS PostgreSQL additive cross-kind triggers/reservations and independent control replay: ${database}`);
    } finally { await storage.close(); }
  } finally {
    await admin.db.exec(`DROP DATABASE "${database}"`);
    await admin.close();
    console.log(`CLEANED PostgreSQL database ${database}; all owned SQL pools closed`);
  }
}
if (import.meta.main) {
  const url = process.argv[2];
  if (!url) throw new TypeError("An owned PostgreSQL fixture URL is required");
  await checkPostgres(url);
}
