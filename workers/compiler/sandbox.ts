import { existsSync } from "node:fs";
import { ServiceError } from "@quire/runtime";

export type Limits = {
  readonly wallSeconds: number;
  readonly memoryBytes: number;
  readonly processes: number;
  readonly workspaceBytes: number;
};
export const defaultLimits: Limits = {
  wallSeconds: 180, memoryBytes: 1073741824, processes: 128, workspaceBytes: 536870912,
};
export type SandboxInput = {
  readonly source: string;
  readonly command: readonly string[];
  readonly limits: Limits;
  readonly signal?: AbortSignal;
  readonly unitId?: string;
  readonly onStderr?: (chunk: string) => void;
};
export type SandboxResult = {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
  readonly unit: string;
  readonly canceled: boolean;
};
const runtimePaths = [
  "/usr/bin", "/usr/lib", "/usr/lib64", "/usr/libexec",
  "/usr/share/texlive", "/usr/share/texmf", "/usr/share/fonts", "/usr/share/fontconfig",
  "/usr/share/ghostscript", "/usr/share/perl5", "/usr/share/perl", "/usr/share/latexmk",
  "/usr/share/poppler", "/usr/share/zoneinfo", "/etc/texmf", "/etc/fonts",
  "/etc/ld.so.cache", "/etc/paperspecs", "/etc/ghostscript", "/etc/alternatives/bibtex",
  "/etc/LatexMk", "/var/lib/texmf", "/var/cache/fontconfig",
] as const;

async function bounded(stream: ReadableStream<Uint8Array>, limit: number,
  onChunk?: (chunk: Uint8Array) => void): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      onChunk?.(result.value);
      length += result.value.byteLength;
      if (length > limit) throw new ServiceError("OUTPUT_LIMIT", 422, "Compiler output exceeds retention limit");
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function sandbox(input: SandboxInput): Promise<SandboxResult> {
  const unit = `quire-compile-${input.unitId ?? crypto.randomUUID()}`;
  if (!/^quire-compile-[a-f0-9-]{36}$/.test(unit)) throw new ServiceError("INVALID_UNIT", 500, "Invalid compiler unit identifier");
  const { limits } = input;
  const args = [
    "/usr/bin/systemd-run", "--user", "--wait", "--pipe", "--collect", "--expand-environment=no", `--unit=${unit}`,
    "-p", `MemoryMax=${limits.memoryBytes}`, "-p", "MemorySwapMax=0",
    "-p", `TasksMax=${limits.processes}`, "-p", `RuntimeMaxSec=${limits.wallSeconds}`,
    "-p", "CPUQuota=100%",
    "-p", "NoNewPrivileges=yes",
    "-p", "KillMode=control-group", "-p", "TimeoutStopSec=1", "-p", "SendSIGKILL=yes",
    "/usr/bin/env", "-i", "PATH=/usr/bin", "/usr/bin/bwrap",
    "--unshare-all", "--unshare-user", "--disable-userns", "--die-with-parent", "--new-session",
    "--cap-drop", "ALL", "--clearenv",
    "--setenv", "PATH", "/usr/bin", "--setenv", "HOME", "/nonexistent",
    "--setenv", "LANG", "C.UTF-8", "--setenv", "TMPDIR", "/work/tmp",
    "--setenv", "XDG_CACHE_HOME", "/work/cache",
    "--setenv", "TEXMFVAR", "/work/texmf-var", "--setenv", "TEXMFCONFIG", "/work/texmf-config",
    "--setenv", "TEXINPUTS", "/src//:", "--setenv", "BIBINPUTS", "/src//:",
  ];
  for (const path of runtimePaths) if (existsSync(path)) args.push("--ro-bind", path, path);
  args.push(
    "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib64", "/lib64", "--ro-bind", input.source, "/src",
    "--proc", "/proc", "--dev", "/dev", "--remount-ro", "/dev",
    "--size", String(limits.workspaceBytes), "--tmpfs", "/work",
    "--symlink", "/work/tmp", "/tmp", "--remount-ro", "/", "--chdir", "/src",
    "--", "/bin/sh", "-c", 'mkdir -p /work/tmp; exec "$@"', "quire", ...input.command,
  );
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const ready = Promise.withResolvers<void>();
  let startup = "";
  const stop = async () => {
    await Promise.race([ready.promise, child.exited]);
    const kill = Bun.spawn(["/usr/bin/systemctl", "--user", "stop", `${unit}.service`], { stdout: "ignore", stderr: "ignore" });
    await kill.exited;
  };
  const cancellation: { promise: Promise<void> | null } = { promise: null };
  const onAbort = () => { cancellation.promise ??= stop(); };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  if (input.signal?.aborted) onAbort();
  try {
    const [stdout, stderr, code] = await Promise.all([
      bounded(child.stdout, 64 * 1024 * 1024), bounded(child.stderr, 8 * 1024 * 1024, (chunk) => {
        const text = new TextDecoder().decode(chunk);
        if (!startup.includes("Running as unit:")) {
          startup += text;
          if (startup.includes("Running as unit:")) ready.resolve();
        }
        input.onStderr?.(text);
      }), child.exited,
    ]);
    return { stdout, stderr: new TextDecoder().decode(stderr), code, unit, canceled: input.signal?.aborted ?? false };
  } catch (error) {
    onAbort();
    if (cancellation.promise) await cancellation.promise;
    await child.exited;
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    if (cancellation.promise) await cancellation.promise;
  }
}
