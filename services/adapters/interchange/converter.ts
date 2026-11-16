import { chmod, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ProjectPathSchema } from "@quire/contracts";
import type { Capability } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { readZip } from "../../core/base";
import type { NativeFile } from "../../core/base";
import { limits } from "../../core/base/limits";
import { runTool } from "./process";
import { installationRoleSession } from "../../operations/installation/launch";
import { installationSandbox } from "../../operations/installation/caller-execution";
import { installationExecutionContext } from "../../operations/installation/caller-execution-context";
import { ControlError } from "../../operations/installation/model";

export const conversionLosses = [
  "Conversion preserves document structure where supported, not exact page layout, fonts or pagination.",
  "Custom TeX macros, classes, executable filters, scripts, comments and tracked changes may be lost or unsupported.",
  "DOCX and Markdown imports retain the original bytes under originals/; conversions never execute uploaded scripts.",
  "Conversion exports are ZIP packages containing the converted document, extracted assets and a manifest.",
] as const;
const imageSchema = z.string().regex(/^(?:[a-zA-Z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/);
const conversionLimits = { wallSeconds: 60, memoryBytes: 512 * 1024 * 1024, processes: 64,
  workspaceBytes: 64 * 1024 * 1024 } as const;
const probeLimits = { ...conversionLimits, wallSeconds: 15, processes: 32 };
export type ConversionRequest = {
  readonly entries: readonly NativeFile[]; readonly main: string;
  readonly from: "docx" | "markdown" | "latex";
  readonly to: "latex" | "docx" | "markdown" | "html";
  readonly signal?: AbortSignal;
};
export class PandocConverter {
  private readonly active = new Set<AbortController>();
  private readonly running = new Set<Promise<unknown>>();
  private probed: Capability | null = null;
  private closed = false;
  constructor(readonly image: string | undefined = Bun.env["QUIRE_PANDOC_IMAGE"]) {}
  capability(): Capability {
    if (this.closed) return { state: "disabled", enabled: false, reason: "Converter has shut down" };
    if (installationRoleSession()) {
      return this.probed ?? { state: "degraded", enabled: false,
        reason: "Signed Pandoc conversion profile has not passed an isolated execution probe" };
    }
    const missing = [
      ...(!Bun.which("docker") ? ["installed Docker CLI and reachable daemon"] : []),
      ...(!this.image ? ["QUIRE_PANDOC_IMAGE set to a locally installed sha256 image digest (build services/adapters/interchange/Dockerfile)"]
        : !imageSchema.safeParse(this.image).success ? ["QUIRE_PANDOC_IMAGE must be an immutable sha256 image digest"] : []),
    ];
    return missing.length ? { state: "unconfigured", enabled: false, reason: `Missing: ${missing.join("; ")}` }
      : this.probed ?? { state: "degraded", enabled: false, reason: "Configured Pandoc image has not passed an isolated execution probe" };
  }
  private async tracked<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) throw new ServiceError("CONVERSION_CLOSED", 503, "Converter has shut down");
    const controller = new AbortController();
    this.active.add(controller);
    const running = work(AbortSignal.any([controller.signal, ...signal ? [signal] : []]));
    this.running.add(running);
    try { return await running; }
    finally { this.running.delete(running); this.active.delete(controller); }
  }
  probe(): Promise<Capability> { return this.tracked(signal => this.probeImage(signal)); }
  private async installedProfile() {
    const selected = await installationExecutionContext({
      kind: "document-convert", backend: "docker", profile: "default", limits: conversionLimits,
    });
    if (!selected?.profile.image || !selected.profile.kinds.includes("pandoc-probe")) {
      throw new ControlError("UPDATES_EXECUTION_PROFILE_UNAVAILABLE", "Signed Docker profile must grant Pandoc probe and conversion");
    }
    const probe = await installationExecutionContext({
      kind: "pandoc-probe", backend: "docker", profile: "default", limits: probeLimits,
    });
    if (probe?.profileId !== selected.profileId) {
      throw new ControlError("UPDATES_EXECUTION_PROFILE_UNAVAILABLE", "Pandoc probe and conversion must select the same signed profile");
    }
    return selected;
  }
  private async sourceRoot(): Promise<string> {
    const session = installationRoleSession();
    const data = session?.permit.binding.data;
    const parent = data ? join(data.dialect === "sqlite" ? data.dataRoot : dirname(data.applicationSecretRef), "work") : tmpdir();
    await mkdir(parent, { recursive: true, mode: 0o700 });
    return mkdtemp(join(parent, "quire-interchange-"));
  }
  private async probeImage(signal: AbortSignal): Promise<Capability> {
    signal.throwIfAborted();
    const configuration = this.capability();
    if (configuration.state === "unconfigured") return configuration;
    const installed = installationRoleSession();
    const name = `quire-interchange-probe-${crypto.randomUUID()}`;
    let root: string | undefined;
    try {
      let version: Uint8Array;
      if (installed) {
        const selected = await this.installedProfile();
        root = await this.sourceRoot();
        const result = await installationSandbox({ source: root, limits: probeLimits,
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          installationWork: { kind: "pandoc-probe" } }, "docker", selected.profile.image);
        if (!result || result.canceled || result.code !== 0) throw new ServiceError("CONVERSION_FAILED", 422, "Isolated Pandoc probe failed");
        version = result.stdout;
      } else {
        if (!this.image) return configuration;
        version = await runTool({
          command: ["docker", "run", "--rm", "--pull=never", "--name", name, "--network=none", "--read-only",
            "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=512m", "--pids-limit=32",
            "--user=65534:65534", "--entrypoint=/usr/bin/pandoc", imageSchema.parse(this.image), "--version"],
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), maxBytes: 16 * 1024,
        });
      }
      signal.throwIfAborted();
      const firstLine = new TextDecoder().decode(version).split("\n")[0];
      this.probed = firstLine?.startsWith("pandoc ")
        ? { state: "ready", enabled: true, reason: firstLine }
        : { state: "degraded", enabled: false, reason: "Configured image did not return a Pandoc version" };
    } catch (error) {
      if (signal.aborted) throw error;
      if (!(error instanceof ServiceError) && !(error instanceof ControlError)) throw error;
      const unconfigured = error instanceof ControlError &&
        ["UPDATES_EXECUTION_PROFILE_UNAVAILABLE", "CONTROL_EXECUTION_LIMITS"].includes(error.code);
      this.probed = { state: unconfigured ? "unconfigured" : "degraded", enabled: false,
        reason: `Install/build the configured Pandoc image and make Docker reachable: ${error.message}` };
    } finally {
      if (!installed) {
        const cleanup = Bun.spawn(["docker", "rm", "--force", name], { stdout: "ignore", stderr: "ignore" });
        await cleanup.exited;
      }
      if (root) await rm(root, { recursive: true, force: true });
    }
    return this.probed;
  }
  convert(input: ConversionRequest): Promise<readonly NativeFile[]> {
    return this.tracked(signal => this.execute({ ...input, signal }), input.signal);
  }
  private async execute(input: ConversionRequest & { readonly signal: AbortSignal }): Promise<readonly NativeFile[]> {
    if (this.closed) throw new ServiceError("CONVERSION_CLOSED", 503, "Converter has shut down");
    input.signal?.throwIfAborted();
    if (this.capability().state === "degraded") await this.probeImage(input.signal);
    if (this.closed) throw new ServiceError("CONVERSION_CLOSED", 503, "Converter has shut down");
    input.signal?.throwIfAborted();
    const capability = this.capability();
    const installed = installationRoleSession();
    if (!capability.enabled || (!installed && !this.image)) throw new ServiceError("CONVERSION_UNCONFIGURED", 503, capability.reason ?? "Configure Pandoc image");
    if (input.entries.length > limits.uploadEntries ||
      input.entries.reduce((sum, file) => sum + file.bytes.length, 0) > limits.uploadBytes) {
      throw new ServiceError("UPLOAD_LIMIT", 413, "Conversion input exceeds expanded archive limits");
    }
    const image = installed ? (await this.installedProfile()).profile.image : imageSchema.parse(this.image);
    const root = await this.sourceRoot();
    const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...input.signal ? [input.signal] : []]);
    const name = `quire-interchange-${crypto.randomUUID()}`;
    try {
      const paths = new Set<string>();
      for (const entry of input.entries) {
        const path = ProjectPathSchema.parse(entry.path);
        if (paths.has(path)) throw new ServiceError("PATH_CONFLICT", 409, "Duplicate conversion input path");
        paths.add(path);
        await mkdir(dirname(join(root, path)), { recursive: true, mode: 0o755 });
        if (entry.folder) await mkdir(join(root, path), { recursive: true, mode: 0o755 });
        else await Bun.write(join(root, path), entry.bytes, { mode: 0o644 });
      }
      const main = ProjectPathSchema.parse(input.main);
      if (!input.entries.some(entry => entry.path === main && !entry.folder)) throw new ServiceError("INVALID_MAIN", 422, "Conversion main is missing");
      if (installed) {
        const result = await installationSandbox({ source: root, limits: conversionLimits, signal,
          installationWork: { kind: "document-convert", mainFile: main, from: input.from, to: input.to } }, "docker", image);
        if (!result || result.canceled || signal.aborted) {
          throw new ServiceError("CONVERSION_TIMEOUT", 503, "Conversion canceled or exceeded its wall budget");
        }
        if (result.code !== 0) throw new ServiceError("CONVERSION_FAILED", 422,
          `Isolated tool exited ${result.code}: ${result.stderr.slice(0, 2048)}`);
        if (result.stdout.byteLength > limits.uploadBytes) {
          throw new ServiceError("CONVERSION_OUTPUT_LIMIT", 413, "Conversion output exceeds configured byte limit");
        }
        return readZip(result.stdout);
      }
      // mkdtemp is private to the host user; the container's unprivileged user needs directory traversal.
      await chmod(root, 0o755);
      const extensions = { latex: "tex", markdown: "md", docx: "docx", html: "html" } as const;
      const output = `document.${extensions[input.to]}`;
      const bytes = await runTool({
        signal, maxBytes: limits.uploadBytes,
        command: ["docker", "run", "--rm", "--pull=never", "--name", name,
          "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
          "--memory=512m", "--memory-swap=512m", "--cpus=1", "--pids-limit=64", "--user=65534:65534",
          "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777",
          "--tmpfs", "/work:rw,nosuid,nodev,noexec,size=64m,mode=1777",
          "--mount", `type=bind,src=${root},dst=/src,readonly`, "--workdir=/work",
          "--entrypoint=/bin/sh", imageSchema.parse(image), "-c",
          'pandoc "$@" && zip -q -r - .', "quire-convert",
          "--from", input.from, "--to", input.to, "--standalone",
          "--resource-path=/src", "--extract-media=media", "--output", `/work/${output}`, `/src/${main}`],
      });
      return readZip(bytes);
    } finally {
      // Docker CLI cancellation does not prove that the isolated container stopped.
      // Its unique name makes this teardown safe even if creation never succeeded.
      if (!installed) {
        const cleanup = Bun.spawn(["docker", "rm", "--force", name], { stdout: "ignore", stderr: "ignore" });
        await cleanup.exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.active) controller.abort();
    await Promise.allSettled(this.running);
  }
}
