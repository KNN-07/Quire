import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sandbox, defaultLimits } from "../../workers/compiler/sandbox";

test("T18 confines owned canaries, network, readonly source and aggregate disk", async () => {
  // Given an owned outside canary and an otherwise empty source tree.
  const root = await mkdtemp(join(tmpdir(), "quire-isolation-"));
  await writeFile(join(root, "canary"), "owned-secret");
  const src = await mkdtemp(join(tmpdir(), "quire-source-"));
  const repository = await mkdtemp(join(import.meta.dir, "canary-"));
  await writeFile(join(repository, "canary"), "owned-repository-canary");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("owned-network-canary") });
  try {
    // When real processes execute inside the namespace and bounded tmpfs.
    const result = await sandbox({ source: src, limits: { ...defaultLimits, workspaceBytes: 1048576 },
      command: ["/bin/sh", "-c", `test ! -e '${root}/canary' &&
        test ! -e '/proc/1/root${root}/canary' &&
        test ! -e '${repository}/canary' &&
        test ! -d /home && test ! -d /run &&
        ! touch /src/forbidden &&
        ! dd if=/dev/zero of=/work/fill bs=1048576 count=2 &&
        perl -MIO::Socket::INET -e 'exit(IO::Socket::INET->new(PeerAddr=>"127.0.0.1",PeerPort=>${server.port},Timeout=>1)?1:0)' &&
        printf ISOLATED`] });
    // Then all forbidden capabilities fail and the command completes.
    expect(result.code, result.stderr).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toBe("ISOLATED");
  } finally {
    await server.stop(true);
    await rm(repository, { recursive: true, force: true });
    await rm(src, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("T18 cgroup memory limit kills an allocating process tree", async () => {
  // Given a private source and a 64 MiB aggregate memory budget.
  const src = await mkdtemp(join(tmpdir(), "quire-memory-"));
  try {
    // When a confined interpreter allocates substantially above that budget.
    const result = await sandbox({ source: src, limits: { ...defaultLimits, memoryBytes: 67108864 },
      command: ["perl", "-e", 'my $x = "x" x (256*1024*1024); print length($x)'] });
    // Then the kernel cgroup OOM boundary terminates it.
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("oom-kill");
  } finally { await rm(src, { recursive: true, force: true }); }
});

test("T18 cgroup task limit bounds forked descendants", async () => {
  // Given an aggregate cgroup process budget of 16.
  const src = await mkdtemp(join(tmpdir(), "quire-pids-"));
  try {
    // When Perl tries to create 100 simultaneously live children.
    const result = await sandbox({ source: src, limits: { ...defaultLimits, processes: 16 },
      command: ["perl", "-MPOSIX", "-e", 'my @p; for (1..100) {my $p=fork(); last unless defined $p; if (!$p) {POSIX::pause(); exit} push @p,$p} kill 9,@p; 1 while wait()>0; print scalar(@p)'] });
    // Then the tree cannot exceed the cgroup task boundary.
    expect(result.code, result.stderr).toBe(0);
    expect(Number(new TextDecoder().decode(result.stdout))).toBeLessThan(16);
    expect(Number(new TextDecoder().decode(result.stdout))).toBeGreaterThan(0);
  } finally { await rm(src, { recursive: true, force: true }); }
});

test("T18 wall timeout removes a real runaway process tree", async () => {
  // Given a private namespace with a half-second wall budget.
  const src = await mkdtemp(join(tmpdir(), "quire-wall-"));
  try {
    // When a shell starts and waits for a long-lived descendant.
    const result = await sandbox({ source: src, limits: { ...defaultLimits, wallSeconds: 0.5 },
      command: ["perl", "-e", "fork(); 1 while 1"] });
    // Then systemd reports the actual whole-group timeout.
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("result: timeout");
  } finally { await rm(src, { recursive: true, force: true }); }
});

test("T18 cancellation kills descendants after their actual readiness signal", async () => {
  // Given a subscribed child-readiness signal in a real confined process tree.
  const src = await mkdtemp(join(tmpdir(), "quire-cancellation-"));
  const controller = new AbortController();
  let childReady = false;
  try {
    // When the child reports readiness, cancellation stops its entire systemd cgroup.
    const result = await sandbox({ source: src, limits: defaultLimits, signal: controller.signal,
      onStderr: (chunk) => { if (chunk.includes("CHILD_READY")) { childReady = true; controller.abort(); } },
      command: ["perl", "-MPOSIX", "-e", 'my $p=fork(); if (!$p) {print STDERR "CHILD_READY\\n"; POSIX::pause()} else {wait()}'] });
    // Then a real descendant existed and the group has terminated.
    expect(childReady).toBe(true);
    expect(result.canceled).toBe(true);
    const state = Bun.spawn(["systemctl", "--user", "is-active", "--quiet", `${result.unit}.service`],
      { stdout: "ignore", stderr: "ignore" });
    expect(await state.exited).not.toBe(0);
    expect(result.stderr).toContain("Service runtime:");
  } finally { await rm(src, { recursive: true, force: true }); }
});
