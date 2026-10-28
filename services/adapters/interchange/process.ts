import { ServiceError } from "@quire/runtime";
import { installationRoleSession } from "../../operations/installation/launch";

/** Fixed operator-selected tools only; no user command or shell interpolation. */
export async function runTool(input: {
  readonly command: readonly string[]; readonly signal: AbortSignal; readonly maxBytes: number;
}): Promise<Uint8Array> {
  if (installationRoleSession()) {
    throw new ServiceError("UPDATES_EXECUTION_RECIPE_REQUIRED", 503,
      "Installed conversion requires a fixed controller recipe");
  }
  input.signal.throwIfAborted();
  const child = Bun.spawn([...input.command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const stop = () => child.kill("SIGKILL");
  input.signal.addEventListener("abort", stop, { once: true });
  const collect = async (stream: ReadableStream<Uint8Array>, limit: number) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          stop();
          throw new ServiceError("CONVERSION_OUTPUT_LIMIT", 413, "Conversion output exceeds configured byte limit");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return new Uint8Array(Buffer.concat(chunks));
  };
  try {
    const [stdout, stderr, code] = await Promise.all([
      collect(child.stdout, input.maxBytes), collect(child.stderr, 64 * 1024), child.exited,
    ]);
    if (input.signal.aborted) throw new ServiceError("CONVERSION_TIMEOUT", 503, "Conversion canceled or exceeded its wall budget");
    if (code !== 0) throw new ServiceError("CONVERSION_FAILED", 422,
      `Isolated tool exited ${code}: ${new TextDecoder().decode(stderr).slice(0, 2048)}`);
    return stdout;
  } finally {
    stop();
    await child.exited;
    input.signal.removeEventListener("abort", stop);
  }
}
