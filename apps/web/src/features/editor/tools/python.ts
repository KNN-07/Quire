import { PythonExecutionError, PythonResultSchema, PythonRunSchema } from "./python-contract";
import type { PythonInstallation, PythonResult } from "./python-contract";

export function executePython(input: {
  readonly installation: PythonInstallation; readonly source: string;
  readonly inputs: readonly { readonly path: string; readonly bytes: Uint8Array }[];
}, signal: AbortSignal): Promise<PythonResult> {
  const index = new URL(input.installation.indexURL);
  if (!input.installation.enabled || index.origin !== location.origin || !index.pathname.endsWith("/")) {
    throw new PythonExecutionError("CONFIGURATION", "Enable an installed same-origin Pyodide runtime directory ending in /.");
  }
  const message = PythonRunSchema.parse({ ...input, id: crypto.randomUUID() });
  if (signal.aborted) return Promise.reject(new PythonExecutionError("CANCELED", "Python execution canceled."));
  const worker = new Worker(new URL("./python.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new PythonExecutionError("TIMEOUT", "Python exceeded the 30 second execution limit.")), 30_000);
    function finish(result: PythonResult | Error) {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      if (result instanceof Error) reject(result); else resolve(result);
    }
    const cancel = () => finish(new PythonExecutionError("CANCELED", "Python execution canceled. No project files were changed."));
    signal.addEventListener("abort", cancel, { once: true });
    worker.addEventListener("error", event => finish(new PythonExecutionError("RUNTIME", event.message)), { once: true });
    worker.addEventListener("message", event => {
      const parsed = PythonResultSchema.safeParse(event.data);
      if (!parsed.success) { finish(new PythonExecutionError("RUNTIME", "Runtime returned an invalid result.")); return; }
      if (parsed.data.id === message.id) finish(parsed.data);
    });
    worker.postMessage(message);
  });
}
