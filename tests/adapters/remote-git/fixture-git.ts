import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function fixtureGit(input: {
  readonly cwd?: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly bytes?: Uint8Array;
}): Promise<Uint8Array> {
  const child = Bun.spawn(["git", ...input.args], {
    ...(input.cwd ? { cwd: input.cwd } : {}),
    stdin: input.bytes ? new Blob([new Uint8Array(input.bytes)]) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: tmpdir(),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      ...input.env,
    },
  });
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new TypeError(`Fixture Git failed: ${error}`);
  return new Uint8Array(output);
}

export async function seedRepository(root: string, repository: string, text: string): Promise<void> {
  const bare = join(root, `${repository}.git`);
  const work = await mkdtemp(join(tmpdir(), "quire-provider-seed-"));
  try {
    await mkdir(join(bare, ".."), { recursive: true });
    await fixtureGit({ args: ["init", "--bare", "--initial-branch=main", bare] });
    await fixtureGit({ cwd: work, args: ["init", "--initial-branch=main"] });
    await fixtureGit({ cwd: work, args: ["config", "user.name", "Provider Fixture"] });
    await fixtureGit({ cwd: work, args: ["config", "user.email", "fixture@example.invalid"] });
    await writeFile(join(work, "main.tex"), text);
    await fixtureGit({ cwd: work, args: ["add", "main.tex"] });
    await fixtureGit({ cwd: work, args: ["commit", "-m", "Initial remote source"] });
    await fixtureGit({ cwd: work, args: ["remote", "add", "origin", bare] });
    await fixtureGit({ cwd: work, args: ["push", "origin", "main"] });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export function basicToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  return decoded.slice(decoded.indexOf(":") + 1);
}

export async function gitBackend(input: {
  readonly root: string;
  readonly request: Request;
  readonly pathname: string;
}): Promise<Response> {
  const url = new URL(input.request.url);
  const bytes = input.request.method === "POST"
    ? new Uint8Array(await input.request.arrayBuffer())
    : undefined;
  const result = await fixtureGit({
    args: [
      "-c", "http.receivepack=true",
      "-c", "receive.fsckObjects=true",
      "-c", "uploadpack.allowFilter=false",
      "http-backend",
    ],
    ...(bytes ? { bytes } : {}),
    env: {
      GIT_PROJECT_ROOT: input.root,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: input.pathname,
      REQUEST_METHOD: input.request.method,
      QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: input.request.headers.get("content-type") ?? "",
      CONTENT_LENGTH: String(bytes?.byteLength ?? 0),
      HTTP_GIT_PROTOCOL: input.request.headers.get("git-protocol") ?? "",
      REMOTE_USER: "fixture-user",
    },
  });
  const decoded = new TextDecoder().decode(result);
  const headerEnd = decoded.indexOf("\r\n\r\n");
  if (headerEnd < 0) throw new TypeError("Malformed fixture Git CGI response");
  const headers = new Headers();
  let status = 200;
  for (const line of decoded.slice(0, headerEnd).split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    if (name.toLowerCase() === "status") status = Number(value.split(" ")[0]);
    else headers.append(name, value);
  }
  return new Response(result.slice(headerEnd + 4), { status, headers });
}
