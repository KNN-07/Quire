import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ExecutionLaunchSchema, ExecutionProfileSchema } from "../../../../services/operations/installation/execution-model";
import { dockerCommand, inspectOwnedContainer } from "../../../../services/operations/installation/execution-docker";
import { cgroupPids, inspectUnit } from "../../../../services/operations/installation/systemd-process";
import { executionFixture } from "./fixture";
import { describeExecutionSource } from "../../../../services/operations/installation/execution-source";

const base = z.string({ error: "Set QUIRE_PANDOC_IMAGE to an installed immutable Pandoc image ID" })
  .regex(/^sha256:[a-f0-9]{64}$/, "QUIRE_PANDOC_IMAGE must be a local immutable sha256 image ID")
  .parse(Bun.env["QUIRE_PANDOC_IMAGE"]);
for (const probe of [true, false]) {
  test(`installed ${probe ? "probe close" : "conversion cancellation"} proves container stop before staging cleanup`, async () => {
    const tag = `quire-p74-lifecycle:${crypto.randomUUID()}`;
    const cache = await mkdtemp(join(tmpdir(), "quire-pandoc-build-"));
    let built = false;
    let tagged = false;
    try {
      const taggedBase = await dockerCommand("/run/docker.sock", ["image", "tag", base, `${tag}-base`]);
      tagged = taggedBase.code === 0;
      expect(taggedBase.code, taggedBase.stderr).toBe(0);
      const child = Bun.spawn(["/usr/bin/docker", "--host", "unix:///run/docker.sock",
        "build", "--network=none", "--pull=false", "-t", tag,
        "--build-arg", `PANDOC_IMAGE=${tag}-base`, "--build-arg", `DELAY_PROBE=${probe ? 1 : 0}`,
        "-f", "tests/operations/installation/supervisor-execution/pandoc-fixture.Dockerfile", "."], {
        env: { ...process.env, DOCKER_CONFIG: cache, BUILDX_CONFIG: join(cache, "buildx") },
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      built = code === 0;
      expect(code, stdout + stderr).toBe(0);
      const inspect = await dockerCommand("/run/docker.sock", ["image", "inspect", tag, "--format", "{{.Id}}"]);
      expect(inspect.code).toBe(0);
      const image = inspect.stdout;
      const profile = ExecutionProfileSchema.parse({ id: "pandoc", roles: ["api-a"],
        kinds: ["pandoc-probe", "document-convert"], backend: "docker", image, maxConcurrent: 2,
        limits: { wallSeconds: 60, memoryBytes: 536870912, processes: 64, workspaceBytes: 67108864 } });
      await using fixture = await executionFixture({ image, profiles: [profile],
        release: "tests/operations/installation/supervisor-execution/pandoc-release.ts" });
      const controller = await fixture.start();
      const eventsAbort = new AbortController();
      try {
        // Subscribe before invoking the role. These fixture payloads remain alive
        // until explicitly stopped; no timing sleeps or large document heuristics.
        const filters = JSON.stringify({ type: ["container"], event: ["start"],
          label: [`quire.installation=${fixture.config.installationId}`] });
        const response = await fetch(`http://docker/events?filters=${encodeURIComponent(filters)}`, {
          unix: "/run/docker.sock", signal: AbortSignal.any([eventsAbort.signal, AbortSignal.timeout(90000)]),
        });
        if (!response.body || !response.ok) throw new Error("Docker event subscription required");
        const reader = response.body.getReader();
        const started = (async () => {
          let pending = ""; let count = 0;
          try {
            while (count < (probe ? 1 : 2)) {
              const part = await reader.read();
              if (part.done) throw new Error("Missing container start");
              pending += new TextDecoder().decode(part.value);
              for (;;) {
                const end = pending.indexOf("\n");
                if (end < 0) break;
                z.object({ Action: z.literal("start") }).parse(JSON.parse(pending.slice(0, end)));
                count++; pending = pending.slice(end + 1);
              }
            }
          } finally { eventsAbort.abort(); reader.releaseLock(); }
        })();
        void started.catch(() => undefined);
        await fixture.role().channel.request("pandoc-begin", { probe });
        await started;
        const before = z.object({ launches: z.array(ExecutionLaunchSchema) }).parse(await controller.request("records", {}));
        const active = before.launches.find(launch => launch.request.work.kind === (probe ? "pandoc-probe" : "document-convert"));
        if (!active) throw new Error("Owned active conversion required");
        await fixture.role().channel.request("payload-ready", { id: active.id });
        expect((await inspectOwnedContainer("/run/docker.sock", active))?.State.Running).toBe(true);
        const result = await fixture.role().channel.request(probe ? "pandoc-close" : "pandoc-cancel", {});
        expect(result).toMatchObject({ ok: false });
        const after = z.object({ launches: z.array(ExecutionLaunchSchema) }).parse(await controller.request("records", {}));
        console.info("P74_STOP_OBSERVED", JSON.stringify({ probe, result, before: active,
          after: after.launches.find(launch => launch.id === active.id) }));
        for (const launch of after.launches) {
          expect(launch.state).toBe("released");
          expect(await inspectOwnedContainer("/run/docker.sock", launch)).toBeNull();
          const unit = await inspectUnit(fixture.config, launch.unit);
          expect(unit.mainPid).toBe(0);
          if (unit.cgroup) expect(await cgroupPids(unit.cgroup)).toEqual([]);
        }
        expect(after.launches.find(launch => launch.id === active.id)?.result?.canceled).toBe(true);
        if (fixture.prior.data.dialect !== "sqlite") throw new Error("SQLite fixture required");
        expect((await readdir(join(fixture.prior.data.dataRoot, "work"))).filter(name => name.startsWith("quire-interchange-"))).toEqual([]);
        console.info("P74_CANCELED", JSON.stringify({ probe, image, launches: after.launches.map(launch => ({
          id: launch.id, kind: launch.request.work.kind, state: launch.state, result: launch.result,
        })) }));
        if (!probe) {
          const sourcePath = join(fixture.prior.data.dataRoot, "work/noisy");
          await mkdir(sourcePath);
          await writeFile(join(sourcePath, "noisy-out.md"), "# noisy");
          await writeFile(join(sourcePath, "noisy-error.md"), "# noisy");
          const source = await describeExecutionSource(sourcePath, profile.limits.workspaceBytes);
          for (const mainFile of ["noisy-out.md", "noisy-error.md"]) {
            const noisy = z.object({ id: z.string() }).parse(await fixture.role().channel.request("start", {
              requestId: crypto.randomUUID(), profileId: profile.id, limits: profile.limits,
              work: { kind: "document-convert", source, mainFile, from: "markdown", to: "latex" },
            }));
            const exit = z.object({ canceled: z.boolean(), stdoutBytes: z.number(), stderrBytes: z.number() })
              .parse(await fixture.role().channel.request("wait", { id: noisy.id }));
            expect(exit.canceled).toBe(true);
            expect(exit.stdoutBytes).toBeLessThanOrEqual(67108864);
            expect(exit.stderrBytes).toBeLessThanOrEqual(65536);
            await fixture.role().channel.request("release", { id: noisy.id });
            console.info("P74_OUTPUT_LIMIT", JSON.stringify({ mainFile, ...exit }));
          }
        }
      } finally { eventsAbort.abort(); }
    } finally {
      if (built) {
        const removed = await dockerCommand("/run/docker.sock", ["image", "rm", tag]);
        expect(removed.code, removed.stderr).toBe(0);
      }
      if (tagged) {
        const removed = await dockerCommand("/run/docker.sock", ["image", "rm", `${tag}-base`]);
        expect(removed.code, removed.stderr).toBe(0);
      }
      await rm(cache, { recursive: true, force: true });
    }
  }, 240000);
}
