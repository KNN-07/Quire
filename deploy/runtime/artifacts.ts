import { cp, mkdir, realpath, stat } from "node:fs/promises";
import { resolve, sep, join } from "node:path";

export class ArtifactError extends Error {
  constructor(readonly code: string, readonly target: string) {
    super(`${code}: ${target}`);
    this.name = "ArtifactError";
  }
}

export async function checked(command: readonly string[], cwd?: string): Promise<string> {
  const child = Bun.spawn([...command], {
    ...(cwd ? { cwd } : {}), stdout: "pipe", stderr: "pipe", stdin: "ignore",
  });
  const [output, error, exit] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (exit !== 0) throw new ArtifactError("COMMAND_FAILED", `${command[0]} exit=${exit}\n${error}`);
  return output.trim();
}

/** No implicit destination replacement: upgrades install a fresh release prefix. */
export async function freshDirectory(path: string): Promise<string> {
  const target = resolve(path);
  if (target === "/" || /^\/(?:usr|bin|sbin|etc|var|opt|srv|home\/[^/]+\/\.local)(?:\/|$)/.test(target)) {
    throw new ArtifactError("OWNED_PREFIX_REQUIRED", target);
  }
  await mkdir(target, { mode: 0o700 });
  return target;
}

export async function copyRelease(source: string, target: string): Promise<void> {
  const root = await realpath(source);
  if (resolve(target).startsWith(root + sep)) throw new ArtifactError("NESTED_DESTINATION", target);
  for (const name of ["package.json", "bun.lock", ".bun-version", "tsconfig.json", "apps", "packages",
    "services", "workers", "scripts", "deploy", "dist", "node_modules"]) {
    const path = join(root, name);
    await stat(path);
    await cp(path, join(target, name), {
      recursive: true, dereference: name !== "node_modules", verbatimSymlinks: name === "node_modules",
      errorOnExist: true, force: false,
    });
  }
}
