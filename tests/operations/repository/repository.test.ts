import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { once } from "node:events";
import { z } from "zod";
import type { RepositoryIntent } from "@quire/contracts";
import { leaseSchema } from "../../../services/operations/repository/journal";
import { RemoteRepositoryService } from "../../../services/operations/repository";
import { InstantSchema } from "@quire/contracts";
import { Worker, bounded, commit, fixture, id, text } from "./fixture";
import { gitRunner, ownVolume } from "../../../services/operations/repository/process";

test("surviving Git child retains durable volume exclusion after its owner descriptor closes", async () => {
  const volume = await mkdtemp(join(tmpdir(), "quire-p1s-repository-lock-"));
  const paused = Promise.withResolvers<Socket>();
  const listener = createServer((socket) => {
    socket.once("data", () => paused.resolve(socket));
  });
  const listening = once(listener, "listening");
  listener.listen(join(volume, ".probe.sock"));
  await listening;
  const owner = await ownVolume(volume);
  const run = gitRunner(owner, [process.execPath, import.meta.dir + "/git-probe.ts"]);
  const command = run(join(volume, "probe.git"), ["--version"]);
  const socket = await bounded(paused.promise);
  try {
    // Equivalent to the service losing its descriptor during process death.
    await owner.close();
    await rejects(ownVolume(volume), /REPOSITORY_VOLUME_OWNED/);
  } finally {
    socket.write("run\n");
    expect(new TextDecoder().decode(await bounded(command))).toContain("git version");
    const replacement = await ownVolume(volume);
    await replacement.close();
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    await rm(volume, { recursive: true, force: true });
    console.log(`CLEANED ${volume} inherited-lock child/listener exited`);
  }
}, 30000);

test("two independent API processes authenticate, CAS, and atomically expose finalized refs", async () => {
  const f = await fixture();
  try {
    const project = id();
    const unauthorized = await fetch(new URL("/v1/initialize", f.endpoint), { method: "POST", body: JSON.stringify({ projectId: project }) });
    expect(unauthorized.status).toBe(401);
    const duplicate = new Worker(f.config);
    await rejects(duplicate.started(), /REPOSITORY_VOLUME_OWNED/);
    await duplicate.exited;
    await f.first.call("initialize", project);
    const next = await commit(f.first, project, "named");
    const lease = leaseSchema.parse(await f.first.call("acquire", { scope: { projectId: project, branch: "main" }, owner: "api-one", ttl: 60000 }));
    const intent: RepositoryIntent = { id: id(), lease, updates: [{ ref: "refs/heads/main", expected: null, next }] };
    await f.first.call("publish", intent);
    await f.first.call("publish", intent);
    await rejects(f.second.call("read", { project, args: ["rev-parse", "refs/heads/main"] }), /REPOSITORY_NOT_FINALIZED/);
    await rejects(f.second.call("export", project), /REPOSITORY_NOT_FINALIZED/);
    await rejects(f.first.call("finalize", { id: intent.id, lease, rollback: true }), /ROLLBACK_FINALIZATION/);
    expect(await f.db.all("SELECT * FROM receipts")).toEqual([]);
    await rejects(f.second.call("readable", project), /REPOSITORY_NOT_FINALIZED/);
    await f.first.call("finalize", { id: intent.id, lease });
    expect(text(await f.second.call("read", { project, args: ["rev-parse", "refs/heads/main"] }))).toBe(next.slice(5));
    const pending = { id: id(), lease, updates: [{ ref: "refs/heads/main", expected: next, next: await commit(f.second, project, "second") }] };
    await f.second.call("publish", pending);
    await rejects(f.first.call("publish", { ...pending, id: id() }), /REPOSITORY_RECOVERY_REQUIRED/);
    await f.second.call("finalize", { id: pending.id, lease });
    await rejects(f.first.call("objects", { project, args: ["update-ref", "refs/heads/escape", next.slice(5)] }), /REPOSITORY_COMMAND_FORBIDDEN/);
    const rows = await f.db.all<{ state: string }>("SELECT state FROM repository_intents");
    expect(rows.every((row) => row.state === "finalized")).toBe(true);
  } finally { await f.close(); }
}, 30000);

test("paused old caller resumes only after takeover and is rejected at service execution", async () => {
  const f = await fixture();
  try {
    const project = id();
    await f.first.call("initialize", project);
    const next = await commit(f.first, project, "stale");
    const scope = { projectId: project, branch: "main" };
    const old = leaseSchema.parse(await f.first.call("acquire", { scope, owner: "paused-api", ttl: 1000 }));
    // No timing sleep: caller is stopped after its lease response and before publish.
    f.first.child.kill("SIGSTOP");
    await f.second.call("time", Date.parse("2026-10-27T00:00:02.000Z"));
    // Server clock is controlled independently; never wait for real TTL expiration.
    await f.serverTime(Date.parse("2026-10-27T00:00:02.000Z"));
    const current = leaseSchema.parse(await f.second.call("acquire", { scope, owner: "api-two", ttl: 60000 }));
    expect(current.fence).toBe(old.fence + 1);
    f.first.child.kill("SIGCONT");
    await rejects(f.first.call("publish", { id: id(), lease: old, updates: [{ ref: "refs/heads/main", expected: null, next }] }), /STALE_BRANCH_FENCE/);
    expect(await f.db.all("SELECT * FROM repository_intents WHERE project_id=?", [project])).toEqual([]);
    const intent = { id: id(), lease: current, updates: [{ ref: "refs/heads/main", expected: null, next }] };
    await f.second.call("publish", intent);
    await f.second.call("finalize", { id: intent.id, lease: current });
  } finally { f.first.child.kill("SIGCONT"); await f.close(); }
}, 30000);

test("uncertain real Git exit serializes takeover; restart recovery adopts its committed CAS", async () => {
  const f = await fixture(true);
  try {
    const project = id();
    await f.first.call("initialize", project);
    const next = await commit(f.first, project, "uncertain");
    const scope = { projectId: project, branch: "main" };
    const lease = leaseSchema.parse(await f.first.call("acquire", { scope, owner: "old", ttl: 1000 }));
    const intent = { id: id(), lease, updates: [{ ref: "refs/heads/main", expected: null, next }] };
    const paused = f.pauseCas();
    const publication = rejects(f.first.call("publish", intent), /REPOSITORY_GIT_FAILED/);
    const socket = await paused;
    await f.time(Date.parse("2026-10-27T00:00:02.000Z"));
    const takeover = f.second.call("acquire", { scope, owner: "new", ttl: 60000 });
    expect(await f.db.get<{ fence: number }>("SELECT fence FROM branch_leases WHERE project_id=?", [project])).toEqual({ fence: lease.fence });
    socket.write("fail-after\n");
    await publication;
    const successor = leaseSchema.parse(await takeover);
    expect(successor.fence).toBe(lease.fence + 1);
    expect(await f.db.get<{ state: string }>("SELECT state FROM repository_intents WHERE id=?", [intent.id])).toEqual({ state: "prepared" });
    await rejects(f.second.call("publish", { ...intent, id: id(), lease: successor }), /REPOSITORY_RECOVERY_REQUIRED/);
    const endpoint = await f.restart();
    const recovered = new Worker({ ...f.config, role: "caller", url: endpoint });
    await recovered.started();
    try {
      await recovered.call("recover", { id: intent.id, lease: successor });
      await rejects(recovered.call("finalize", { id: intent.id, lease }), /STALE_BRANCH_FENCE/);
      await recovered.call("finalize", { id: intent.id, lease: successor });
      expect(text(await recovered.call("read", { project, args: ["rev-parse", "refs/heads/main"] }))).toBe(next.slice(5));
    } finally { await recovered.close(); }
  } finally { await f.close(); }
}, 30000);

test("failed pre-CAS subprocess recovers, conflicts remain blocked, and named bundles exclude hidden objects", async () => {
  const f = await fixture(true);
  try {
    const project = id();
    await f.first.call("initialize", project);
    const next = await commit(f.first, project, "public root");
    const hidden = await commit(f.first, project, "private root");
    const lease = leaseSchema.parse(await f.first.call("acquire", { scope: { projectId: project, branch: "main" }, owner: "writer", ttl: 60000 }));
    const intent = { id: id(), lease, updates: [
      { ref: "refs/heads/main", expected: null, next },
      { ref: "refs/quire/history/private", expected: null, next: hidden },
    ] };
    const paused = f.pauseCas();
    const failed = rejects(f.first.call("publish", intent), /REPOSITORY_GIT_FAILED/);
    (await paused).write("fail-before\n");
    await failed;
    await f.second.call("recover", { id: intent.id, lease });
    await f.second.call("finalize", { id: intent.id, lease });
    const bundle = Buffer.from(z.string().parse(await f.second.call("export", project)), "base64");
    const temp = await mkdtemp(join(f.volume, "verify-public-"));
    try {
      await writeFile(join(temp, "public.bundle"), bundle);
      const clone = Bun.spawn(["git", "clone", "--bare", join(temp, "public.bundle"), join(temp, "clone.git")], { stdout: "ignore", stderr: "pipe" });
      expect(await clone.exited).toBe(0);
      const privateObject = Bun.spawn(["git", "--git-dir", join(temp, "clone.git"), "cat-file", "-e", hidden.slice(5)], { stdout: "ignore", stderr: "ignore" });
      expect(await privateObject.exited).not.toBe(0);
      const listing = Bun.spawn(["git", "--git-dir", join(temp, "clone.git"), "for-each-ref", "--format=%(refname)"], { stdout: "pipe" });
      expect((await new Response(listing.stdout).text()).trim()).toBe("refs/heads/main");
      expect(await listing.exited).toBe(0);
      const packer = Bun.spawn(["git", "--git-dir", join(temp, "clone.git"), "pack-objects", "--stdout", "--all"],
        { stdout: "pipe", stderr: "pipe" });
      const pack = Buffer.from(await new Response(packer.stdout).arrayBuffer()).toString("base64");
      expect(await packer.exited).toBe(0);
      const imported = id();
      await f.first.call("initialize", imported);
      await f.first.call("import", { project: imported, pack });
      expect(text(await f.first.call("objects", { project: imported, args: ["cat-file", "-t", next.slice(5)] }))).toBe("commit");
      expect(text(await f.first.call("objects", { project: imported, args: ["for-each-ref"] }))).toBe("");
    } finally { await rm(temp, { recursive: true, force: true }); }
    await rejects(f.first.call("import", { project, pack: Buffer.from("not a pack").toString("base64") }), /REPOSITORY_GIT_FAILED/);
    const conflict = { id: id(), lease, updates: [{ ref: "refs/heads/main", expected: hidden, next: null }] };
    await rejects(f.first.call("publish", conflict), /REPOSITORY_REF_CONFLICT/);
    await rejects(f.second.call("readable", project), /REPOSITORY_NOT_FINALIZED/);
    expect(await f.db.get<{ state: string }>("SELECT state FROM repository_intents WHERE id=?", [conflict.id])).toEqual({ state: "conflicted" });
    const client = new RemoteRepositoryService({ url: f.endpoint, token: f.token,
      clock: { now: () => InstantSchema.parse("2026-10-27T00:00:00.000Z") } });
    await client.close();
    await rejects(client.initialize(id()), /initialize/);
  } finally { await bounded(f.close()); }
}, 30000);
