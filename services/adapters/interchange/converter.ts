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

export const conversionLosses = [
  "Conversion preserves document structure where supported, not exact page layout, fonts or pagination.",
  "Custom TeX macros, classes, executable filters, scripts, comments and tracked changes may be lost or unsupported.",
  "DOCX and Markdown imports retain the original bytes under originals/; conversions never execute uploaded scripts.",
  "Conversion exports are ZIP packages containing the converted document, extracted assets and a manifest.",
] as const;
const imageSchema = z.string().regex(/^(?:[a-zA-Z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/);
export type ConversionRequest = {
  readonly entries: readonly NativeFile[]; readonly main: string;
  readonly from: "docx" | "markdown" | "latex";
  readonly to: "latex" | "docx" | "markdown" | "html";
  readonly signal?: AbortSignal;
};
export class PandocConverter {
  private readonly active = new Set<AbortController>();
  private readonly running = new Set<Promise<readonly NativeFile[]>>();
  private probed: Capability | null = null;
  private closed = false;
  constructor(readonly image: string | undefined = Bun.env["QUIRE_PANDOC_IMAGE"]) {}
  capability(): Capability {
    if (installationRoleSession()) {
      return { state: "unconfigured", enabled: false,
        reason: "Installed Pandoc conversion requires a signed controller execution recipe; none is supported" };
    }
    const missing = [
      ...(!Bun.which("docker") ? ["installed Docker CLI and reachable daemon"] : []),
      ...(!this.image ? ["QUIRE_PANDOC_IMAGE set to a locally installed sha256 image digest (build services/adapters/interchange/Dockerfile)"]
        : !imageSchema.safeParse(this.image).success ? ["QUIRE_PANDOC_IMAGE must be an immutable sha256 image digest"] : []),
    ];
    return missing.length ? { state: "unconfigured", enabled: false, reason: `Missing: ${missing.join("; ")}` }
      : this.probed ?? { state: "degraded", enabled: false, reason: "Configured Pandoc image has not passed an isolated execution probe" };
  }
  async probe(): Promise<Capability> {
    const configuration = this.capability();
    if (configuration.state === "unconfigured") return configuration;
    const name = `quire-interchange-probe-${crypto.randomUUID()}`;
    try {
      if (!this.image) return configuration;
      const version = await runTool({
        command: ["docker", "run", "--rm", "--pull=never", "--name", name, "--network=none", "--read-only",
          "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=512m", "--pids-limit=32",
          "--user=65534:65534", "--entrypoint=/usr/bin/pandoc", imageSchema.parse(this.image), "--version"],
        signal: AbortSignal.timeout(15_000), maxBytes: 16 * 1024,
      });
      const firstLine = new TextDecoder().decode(version).split("\n")[0];
      this.probed = firstLine?.startsWith("pandoc ")
        ? { state: "ready", enabled: true, reason: firstLine }
        : { state: "degraded", enabled: false, reason: "Configured image did not return a Pandoc version" };
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      this.probed = { state: "degraded", enabled: false,
        reason: `Install/build the configured Pandoc image and make Docker reachable: ${error.message}` };
    } finally {
      const cleanup = Bun.spawn(["docker", "rm", "--force", name], { stdout: "ignore", stderr: "ignore" });
      await cleanup.exited;
    }
    return this.probed;
  }
  async convert(input: ConversionRequest): Promise<readonly NativeFile[]> {
    const work = this.execute(input);
    this.running.add(work);
    try { return await work; }
    finally { this.running.delete(work); }
  }
  private async execute(input: ConversionRequest): Promise<readonly NativeFile[]> {
    if (this.closed) throw new ServiceError("CONVERSION_CLOSED", 503, "Converter has shut down");
    input.signal?.throwIfAborted();
    if (this.capability().state === "degraded") await this.probe();
    if (this.closed) throw new ServiceError("CONVERSION_CLOSED", 503, "Converter has shut down");
    input.signal?.throwIfAborted();
    const capability = this.capability();
    if (!capability.enabled || !this.image) throw new ServiceError("CONVERSION_UNCONFIGURED", 503, capability.reason ?? "Configure Pandoc image");
    if (input.entries.length > limits.uploadEntries ||
      input.entries.reduce((sum, file) => sum + file.bytes.length, 0) > limits.uploadBytes) {
      throw new ServiceError("UPLOAD_LIMIT", 413, "Conversion input exceeds expanded archive limits");
    }
    const image = imageSchema.parse(this.image);
    const root = await mkdtemp(join(tmpdir(), "quire-interchange-"));
    const controller = new AbortController();
    this.active.add(controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000), ...input.signal ? [input.signal] : []]);
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
      if (!paths.has(main)) throw new ServiceError("INVALID_MAIN", 422, "Conversion main is missing");
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
          "--entrypoint=/bin/sh", image, "-c",
          'pandoc "$@" && zip -q -r - .', "quire-convert",
          "--from", input.from, "--to", input.to, "--standalone",
          "--resource-path=/src", "--extract-media=media", "--output", `/work/${output}`, `/src/${main}`],
      });
      return readZip(bytes);
    } finally {
      // Docker CLI cancellation does not prove that the isolated container stopped.
      // Its unique name makes this teardown safe even if creation never succeeded.
      const cleanup = Bun.spawn(["docker", "rm", "--force", name], { stdout: "ignore", stderr: "ignore" });
      await cleanup.exited;
      await rm(root, { recursive: true, force: true });
      this.active.delete(controller);
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.active) controller.abort();
    await Promise.allSettled(this.running);
  }
}
