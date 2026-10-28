import { fileURLToPath } from "node:url";

async function drain(stream: ReadableStream<Uint8Array>, consume: (chunk: Uint8Array) => void) {
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      consume(next.value);
    }
  } finally { reader.releaseLock(); }
}

/** Vite's Node HTTP proxy runs under Node; the application API stays on Bun. */
export async function startEditorWeb(root: string, cacheDir: string, target: string) {
  const process = Bun.spawn(["node", fileURLToPath(new URL("./web-server.mjs", import.meta.url)), root, cacheDir, target], {
    stdout: "pipe", stderr: "pipe",
  });
  const ready = Promise.withResolvers<URL>();
  let diagnostic = "";
  const errors = (async () => {
    const decoder = new TextDecoder();
    await drain(process.stderr, chunk => { diagnostic = (diagnostic + decoder.decode(chunk, { stream: true })).slice(-8192); });
  })();
  const output = (async () => {
    const decoder = new TextDecoder();
    let pending = "";
    await drain(process.stdout, chunk => {
      pending += decoder.decode(chunk, { stream: true });
      let boundary: number;
      while ((boundary = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, boundary);
        pending = pending.slice(boundary + 1);
        if (line.startsWith("QUIRE_EDITOR_WEB_READY=")) ready.resolve(new URL(line.slice("QUIRE_EDITOR_WEB_READY=".length)));
      }
    });
  })();
  const deadline = setTimeout(() => ready.reject(new Error("Editor web listener did not become ready")), 30000);
  const exited = process.exited.then(async code => {
    await errors;
    ready.reject(new Error(`Editor web process exited ${code}: ${diagnostic}`));
  });
  async function close() {
    if (process.exitCode === null) process.kill("SIGTERM");
    await process.exited;
    await Promise.all([output, errors, exited]);
  }
  try {
    const url = await ready.promise;
    return { url, close };
  } catch (error) {
    await close();
    throw error;
  } finally { clearTimeout(deadline); }
}
