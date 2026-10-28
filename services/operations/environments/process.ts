import { ServiceError } from "@quire/runtime";
import { installationRoleSession } from "../installation/launch";

export async function runCommand(command: readonly string[], options: {
  readonly cwd?: string; readonly seconds: number;
  readonly signal?: AbortSignal;
  readonly started?: () => Promise<void>;
}) {
  if (installationRoleSession()) {
    throw new ServiceError("UPDATES_EXECUTION_RECIPE_REQUIRED",503,"Installed environment work requires a fixed controller recipe");
  }
  options.signal?.throwIfAborted();
  const child = Bun.spawn([...command], {
    ...(options.cwd ? { cwd: options.cwd } : {}), stdin: "ignore", stdout: "pipe", stderr: "pipe",
    ...(options.signal ? {signal:options.signal} : {}),
  });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; child.kill(); }, options.seconds * 1000);
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = stream.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16 * 1024 * 1024) {
          child.kill();
          throw new ServiceError("BUILD_OUTPUT_LIMIT", 422, "Build output exceeded retention limit");
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    return new TextDecoder().decode(Buffer.concat(chunks));
  };
  try {
    await options.started?.();
    const [stdout,stderr,code] = await Promise.all([collect(child.stdout),collect(child.stderr),child.exited]);
    return { stdout, stderr, code: timedOut ? 124 : code };
  } catch(error) {
    child.kill();
    throw error;
  } finally { clearTimeout(timeout); await child.exited; }
}
