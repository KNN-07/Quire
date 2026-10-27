import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "../../workers/compiler/build";
import { defaultLimits } from "../../workers/compiler/sandbox";
import { sourceFixture, settings } from "./fixtures";

test("T18 hostile TeX and latexmkrc cannot reach owned host and cross-job canaries", async () => {
  // Given canaries outside the immutable source mount and a host-only loopback listener.
  const root = await mkdtemp(join(tmpdir(), "quire-hostile-canaries-"));
  await writeFile(join(root, "secret"), "owned-host-secret");
  await writeFile(join(root, "other-job"), "owned-other-job-secret");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("owned-network-canary") });
  try {
    const fixture = sourceFixture(`\\documentclass{article}\\begin{document}
\\newread\\owned\\openin\\owned=${root}/secret
\\ifeof\\owned Blocked host input.\\else\\errmessage{Host canary escaped isolation}\\fi
\\end{document}`, { "latexmkrc": `
use IO::Socket::INET;
die "host secret visible" if -e '${root}/secret';
die "cross-job visible" if -e '${root}/other-job';
die "host network reachable" if IO::Socket::INET->new(PeerAddr=>'127.0.0.1',PeerPort=>${server.port},Timeout=>1);
open(my $proof, '>', '/work/isolation-proof') or die $!; print $proof 'isolated'; close($proof);
` });
    // When real executable project configuration and TeX run inside the normal compiler boundary.
    const result = await build({ ...fixture, settings });
    // Then the malicious probes are blocked while legitimate compilation still works.
    expect(result.success, result.log).toBe(true);
    expect(new TextDecoder().decode(result.files.get("isolation-proof"))).toBe("isolated");
  } finally { await server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 60000);

test("T18 project latexmkrc descendants share the actual task limit", async () => {
  // Given an executable project rc that attempts 100 simultaneous descendants.
  const fixture = sourceFixture("\\documentclass{article}\\begin{document}Bounded custom rules.\\end{document}", {
    "latexmkrc": `use POSIX; my @p; for (1..100) { my $p=fork(); last unless defined $p;
if (!$p) {POSIX::pause(); exit} push @p,$p; } kill 9,@p; 1 while wait()>0;
open(my $proof, '>', '/work/task-proof') or die $!; print $proof scalar(@p); close($proof);`,
  });
  // When real latexmk starts its custom rule under a sixteen-task cgroup.
  const result = await build({ ...fixture, settings, limits: { ...defaultLimits, processes: 16 } });
  // Then the rc cannot fork past that process-tree budget and TeX can still finish afterward.
  expect(result.success, result.log).toBe(true);
  const count = Number(new TextDecoder().decode(result.files.get("task-proof")));
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(16);
}, 60000);
