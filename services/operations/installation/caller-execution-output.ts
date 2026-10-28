import { ServiceError } from "@quire/runtime";
import type { OwnedExecution } from "./execution-model";

/** Caller adaptation: consume actual retained output, never emulate a Bun child. */
export async function collectInstallationExecution(execution: OwnedExecution, options: {
  readonly signal?: AbortSignal;
  readonly onStderr?: (text: string) => void;
}) {
  let cancellation: Promise<unknown> | undefined;
  const abort = () => {
    cancellation ??= execution.stop();
    void cancellation.catch(() => undefined);
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const exit = await execution.exited;
    await cancellation;
    async function collect(stream: "stdout" | "stderr", limit: number, expected: number): Promise<Uint8Array> {
      if (expected > limit) throw new ServiceError("OUTPUT_LIMIT", 422, "Execution output exceeds retention limit");
      if (expected === 0) return new Uint8Array(0);
      const chunks: Uint8Array[] = [];
      let offset = 0;
      for (;;) {
        const chunk = await execution.read(stream, offset, 32768);
        if (chunk.nextOffset !== offset + chunk.bytes.byteLength || chunk.nextOffset > limit ||
            (!chunk.complete && chunk.nextOffset === offset)) {
          throw new ServiceError("EXECUTION_OUTPUT_INVALID", 503, "Completed execution output is incomplete");
        }
        chunks.push(chunk.bytes);
        if (stream === "stderr" && chunk.bytes.byteLength) options.onStderr?.(new TextDecoder().decode(chunk.bytes));
        offset = chunk.nextOffset;
        if (chunk.complete) break;
      }
      if (offset !== expected) throw new ServiceError("EXECUTION_OUTPUT_INVALID", 503, "Execution output byte count changed");
      return new Uint8Array(Buffer.concat(chunks));
    }
    const [stdout, stderr] = await Promise.all([
      collect("stdout", 64 * 1024 * 1024, exit.stdoutBytes),
      collect("stderr", 8 * 1024 * 1024, exit.stderrBytes),
    ]);
    if (exit.interrupted || exit.code === null) {
      if (options.signal?.aborted) throw new DOMException("Controlled execution canceled", "AbortError");
      throw new ServiceError("EXECUTION_INTERRUPTED", 503, "Execution has no proven payload exit result");
    }
    return { stdout, stderr: new TextDecoder().decode(stderr), code: exit.code,
      canceled: exit.canceled || (options.signal?.aborted ?? false), id: exit.id, image: exit.image };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await execution.release();
  }
}
