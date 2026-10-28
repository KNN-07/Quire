import { z } from "zod";
import { PythonRunSchema } from "./python-contract";

type Runtime = {
  readonly version: string;
  readonly runPythonAsync: (source: string) => Promise<unknown>;
  readonly setStdout: (options: { readonly batched: (line: string) => void }) => void;
  readonly setStderr: (options: { readonly batched: (line: string) => void }) => void;
  readonly FS: {
    readonly mkdirTree: (path: string) => void;
    readonly writeFile: (path: string, bytes: Uint8Array) => void;
    readonly readFile: (path: string) => Uint8Array;
    readonly readdir: (path: string) => readonly string[];
    readonly lstat: (path: string) => { readonly mode: number; readonly size: number };
  };
};
type Loader = (options: { readonly indexURL: string }) => Promise<Runtime>;
const moduleSchema = z.object({ loadPyodide: z.custom<Loader>(value => typeof value === "function") });
const runtimeSchema = z.custom<Runtime>(value => {
  if (typeof value !== "object" || value === null || !("FS" in value)) return false;
  const fs = value.FS;
  return typeof fs === "object" && fs !== null &&
    ["mkdirTree", "writeFile", "readFile", "readdir", "lstat"].every(name => Reflect.get(fs, name) instanceof Function) &&
    "version" in value && typeof value.version === "string" &&
    "runPythonAsync" in value && typeof value.runPythonAsync === "function" &&
    "setStdout" in value && typeof value.setStdout === "function" &&
    "setStderr" in value && typeof value.setStderr === "function";
});

self.addEventListener("message", event => { void execute(event.data); }, { once: true });

async function execute(data: unknown) {
  const request = PythonRunSchema.parse(data);
  try {
    const index = new URL(request.installation.indexURL);
    if (!request.installation.enabled || index.origin !== self.location.origin) throw new TypeError("Runtime must be explicitly enabled and same-origin.");
    const moduleURL = new URL("pyodide.mjs", index).href;
    const module = moduleSchema.parse(await import(/* @vite-ignore */ moduleURL));
    const runtime = runtimeSchema.parse(await module.loadPyodide({ indexURL: index.href }));
    if (runtime.version !== request.installation.version) throw new TypeError(`Installed runtime is ${runtime.version}, expected ${request.installation.version}.`);
    const stdout: string[] = [];
    let outputLength = 0;
    const log = (line: string) => {
      const remaining = 64_000 - outputLength;
      if (remaining <= 0) return;
      const chunk = line.slice(0, remaining);
      stdout.push(chunk);
      outputLength += chunk.length + 1;
    };
    runtime.setStdout({ batched: log }); runtime.setStderr({ batched: log });
    runtime.FS.mkdirTree("/inputs"); runtime.FS.mkdirTree("/outputs");
    for (const file of request.inputs) {
      const path = `/inputs/${file.path}`;
      runtime.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
      runtime.FS.writeFile(path, file.bytes);
    }
    await runtime.runPythonAsync(request.source);
    const files: { readonly path: string; readonly bytes: Uint8Array }[] = [];
    const pending = [""];
    let total = 0;
    while (pending.length) {
      const directory = pending.pop() ?? "";
      for (const name of runtime.FS.readdir(`/outputs/${directory}`)) {
        if (name === "." || name === "..") continue;
        const path = directory + name;
        const stat = runtime.FS.lstat(`/outputs/${path}`);
        const kind = stat.mode & 0o170000;
        if (kind === 0o040000) { pending.push(`${path}/`); continue; }
        if (kind !== 0o100000) throw new TypeError("Generated symbolic links and special files are not supported.");
        total += stat.size;
        if (total > 5 * 1024 * 1024 || files.length >= 20) throw new RangeError("Generated output exceeds 20 files or 5 MiB.");
        files.push({ path, bytes: new Uint8Array(runtime.FS.readFile(`/outputs/${path}`)) });
      }
    }
    self.postMessage({ kind: "complete", id: request.id, version: runtime.version, stdout, files });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    self.postMessage({ kind: "error", id: request.id, message: error.message });
  }
}
