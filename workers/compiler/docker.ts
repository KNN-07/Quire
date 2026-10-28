import { chmod, copyFile, lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServiceError } from "@quire/runtime";
import { z } from "zod";
import type { SandboxInput, SandboxResult } from "./sandbox";
import { installationSandbox } from "../../services/operations/installation/caller-execution";

export type DockerSandboxInput = SandboxInput & { readonly image: string };

/** Copy only ordinary snapshot files. The mounted child is readable by the
 * container UID; its host parent remains private to the worker. */
async function materialize(source: string, target: string, budget: number): Promise<number> {
  await mkdir(target, { mode: 0o755 });
  let bytes = 0;
  for (const name of await readdir(source)) {
    const from = join(source, name);
    const to = join(target, name);
    const stat = await lstat(from);
    if (stat.isDirectory()) bytes += await materialize(from, to, budget - bytes);
    else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > budget) throw new ServiceError("SOURCE_LIMIT", 422, "Snapshot exceeds workspace budget");
      await copyFile(from, to);
      await chmod(to, 0o444);
    } else throw new ServiceError("INVALID_SOURCE", 422, "Snapshot contains a link or special file");
  }
  return bytes;
}

export async function dockerSandbox(input: DockerSandboxInput): Promise<SandboxResult> {
  const installed = await installationSandbox(input, "docker", input.image);
  if (installed) return installed;
  if (!/^sha256:[a-f0-9]{64}$/.test(input.image)) {
    throw new ServiceError("INVALID_IMAGE", 422, "Docker execution requires an immutable local image digest");
  }
  const inspectionSignal = AbortSignal.any([
    AbortSignal.timeout(Math.min(input.limits.wallSeconds,10)*1000),
    ...(input.signal ? [input.signal] : []),
  ]);
  const inspect = Bun.spawn(["docker","image","inspect",input.image,"--format","{{json .Config.Volumes}}"],{
    signal:inspectionSignal,stdin:"ignore",stdout:"pipe",stderr:"pipe",
  });
  const [volumeJson,inspectionError,inspectionCode] = await Promise.all([
    new Response(inspect.stdout).text(),new Response(inspect.stderr).text(),inspect.exited,
  ]);
  if (inspectionCode !== 0) throw new ServiceError("IMAGE_INSPECTION_FAILED",503,inspectionError);
  const volumes = z.record(z.string(),z.object({})).nullable().parse(JSON.parse(volumeJson));
  if (volumes && Object.keys(volumes).length) {
    throw new ServiceError("INVALID_IMAGE_VOLUMES",422,"Image-declared writable volumes would bypass the workspace quota");
  }
  const id = input.unitId ?? crypto.randomUUID();
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ServiceError("INVALID_UNIT", 500, "Invalid compiler unit identifier");
  const unit = `quire-environment-${id}`;
  const owner=process.env["QUIRE_COMPILER_RESOURCE_OWNER"];
  const root = await mkdtemp(join(tmpdir(), "quire-environment-source-"));
  const source = join(root, "src");
  const limits = input.limits;
  let timedOut = false;
  let removal: Promise<void> | undefined;
  const remove = () => removal ??= (async () => {
    const child = Bun.spawn(["docker", "rm", "--force", "--volumes", unit], { stdout: "ignore", stderr: "pipe" });
    const text = await new Response(child.stderr).text();
    const code = await child.exited;
    if (code !== 0 && !text.includes(`No such container: ${unit}`)) {
      throw new ServiceError("CONTAINER_CLEANUP_FAILED", 500, text);
    }
  })();
  try {
    input.signal?.throwIfAborted();
    await materialize(input.source, source, limits.workspaceBytes);
    const create = Bun.spawn([
      "docker", "create", "--name", unit, "--label", "quire.role=compiler-environment",
      ...(owner ? ["--label",`quire.resource-owner=${owner}`] : []),
      "--read-only", "--network=none", "--cap-drop=ALL", "--security-opt=no-new-privileges=true",
      "--user=65534:65534", "--pids-limit", String(limits.processes),
      "--memory", String(limits.memoryBytes), "--memory-swap", String(limits.memoryBytes),
      "--cpus=1", "--ulimit", "nofile=256:256", "--stop-timeout=1",
      "--tmpfs", `/work:rw,nosuid,nodev,size=${limits.workspaceBytes},mode=1777`,
      "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16777216,mode=1777",
      "--mount", `type=bind,source=${source},target=/src,readonly`,
      "--workdir=/work", input.image, ...input.command,
    ], { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
    const createError = await new Response(create.stderr).text();
    if (await create.exited !== 0) throw new ServiceError("CONTAINER_CREATE_FAILED", 503, createError);
    if (input.signal?.aborted) { await remove(); input.signal.throwIfAborted(); }
    const child = Bun.spawn(["docker", "start", "--attach", unit], {
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    // Subscribe before any asynchronous read; all descendants belong to this
    // named container and forced removal is the cancellation boundary.
    const abort = () => { void remove(); };
    input.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; void remove(); }, limits.wallSeconds * 1000);
    const collect = async (stream: ReadableStream<Uint8Array>, max: number, stderr: boolean) => {
      const chunks: Uint8Array[] = [];
      let length = 0;
      const reader = stream.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > max) {
            await remove();
            throw new ServiceError("OUTPUT_LIMIT", 422, "Compiler output exceeds retention limit");
          }
          if (stderr) input.onStderr?.(new TextDecoder().decode(chunk.value));
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      return new Uint8Array(Buffer.concat(chunks));
    };
    try {
      if (input.signal?.aborted) abort();
      const [stdout, stderr, code] = await Promise.all([
        collect(child.stdout, 64 * 1024 * 1024, false),
        collect(child.stderr, 8 * 1024 * 1024, true), child.exited,
      ]);
      return { stdout, stderr: new TextDecoder().decode(stderr), code: timedOut ? 124 : code,
        canceled: input.signal?.aborted ?? false, unit };
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      await remove();
      await child.exited;
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}
