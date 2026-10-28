import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { GitOidSchema } from "@quire/contracts";
import type { GitOid } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { resolveTarget } from "../shared/network-policy";
import type { DnsResolver } from "../shared/network-policy";

const oidSchema = z.string().regex(/^[0-9a-f]{40}$/);
const refRowSchema = z.tuple([z.string().startsWith("refs/"), oidSchema]);
const treeRowSchema = z.strictObject({
  mode: z.string(), kind: z.string(), oid: oidSchema, path: z.string().min(1),
});
export type RemoteGitOptions = { readonly fixtureOrigins?: readonly string[]; readonly resolve?: DnsResolver };
export type GitCredentials = {
  readonly username: string; readonly password: string; readonly repositoryUrl?: string;
};
type GitRun = {
  readonly path: string; readonly args: readonly string[]; readonly input?: Uint8Array;
  readonly remoteUrl?: string; readonly credentials?: GitCredentials;
  readonly options?: RemoteGitOptions;
};
type GitOutput = { readonly bytes: Uint8Array; readonly text: string };

async function transportArguments(remoteUrl: string, options: RemoteGitOptions): Promise<readonly string[]> {
  const url = new URL(z.url().parse(remoteUrl));
  const fixture = options.fixtureOrigins?.includes(url.origin) === true;
  if (url.protocol !== "https:" && !(fixture && url.protocol === "http:")) {
    throw new ServiceError("GIT_TRANSPORT_DENIED", 400, "Remote Git requires HTTPS");
  }
  const target = await resolveTarget(url, options);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return [
    "-c", "protocol.allow=never",
    "-c", `protocol.${url.protocol.slice(0, -1)}.allow=always`,
    "-c", "http.followRedirects=false",
    "-c", "http.proxy=",
    "-c", `http.curloptResolve=${url.hostname}:${port}:${target.address}`,
  ];
}

async function runGit(input: GitRun): Promise<GitOutput> {
  const transport = input.remoteUrl
    ? await transportArguments(input.remoteUrl, input.options ?? {})
    : ["-c", "protocol.allow=never"];
  const root = input.credentials ? await mkdtemp(join(tmpdir(), "quire-git-auth-")) : null;
  try {
    let askPass: string | undefined;
    if (root) {
      askPass = join(root, "askpass.sh");
      await writeFile(askPass, [
        "#!/bin/sh",
        "case \"$1\" in",
        "  *Username*) printf '%s\\n' \"$QUIRE_GIT_USERNAME\" ;;",
        "  *) printf '%s\\n' \"$QUIRE_GIT_PASSWORD\" ;;",
        "esac",
        "",
      ].join("\n"), { mode: 0o700 });
      await chmod(askPass, 0o700);
    }
    const child = Bun.spawn([
      "git",
      "-c", "core.hooksPath=/dev/null",
      ...transport,
      "--git-dir", input.path,
      ...input.args,
    ], {
      stdin: input.input ? new Blob([new Uint8Array(input.input)]) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        HOME: root ?? tmpdir(),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS_REQUIRE: "force",
        ...(askPass ? { GIT_ASKPASS: askPass } : {}),
        ...(input.credentials ? {
          QUIRE_GIT_USERNAME: input.credentials.username,
          QUIRE_GIT_PASSWORD: input.credentials.password,
        } : {}),
      },
    });
    const [buffer, error, code] = await Promise.all([
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) {
      throw new ServiceError("REMOTE_GIT_FAILED", 502,
        error.includes("Authentication failed") || error.includes("could not read Username")
          ? "Remote Git authentication failed"
          : `Remote Git ${input.args[0] ?? "command"} failed`);
    }
    const normalized = new Uint8Array(buffer);
    return { bytes: normalized, text: new TextDecoder().decode(normalized).trim() };
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
}

function parseRefs(text: string, prefix: string): ReadonlyMap<string, string> {
  if (!text) return new Map();
  return new Map(text.split("\n").map((line) => {
    const separator = line.indexOf(" ");
    const parsed = refRowSchema.parse([line.slice(separator + 1), line.slice(0, separator)]);
    return [parsed[0].slice(prefix.length), parsed[1]];
  }));
}

export class RemoteRepository {
  private constructor(
    readonly root: string,
    readonly path: string,
    readonly url: string,
    private readonly credentials: GitCredentials | undefined,
    private readonly options: RemoteGitOptions,
  ) {}

  static async open(input: {
    readonly url: string;
    readonly credentials?: GitCredentials;
    readonly options?: RemoteGitOptions;
  }): Promise<RemoteRepository> {
    if (input.credentials?.repositoryUrl && new URL(input.url).href !== input.credentials.repositoryUrl) {
      throw new ServiceError("GIT_CREDENTIAL_SCOPE", 403, "Saved credentials belong to another repository");
    }
    const root = await mkdtemp(join(tmpdir(), "quire-remote-git-"));
    const path = join(root, "remote.git");
    try {
      await runGit({ path, args: ["init", "--bare", path] });
      const repository = new RemoteRepository(root, path, input.url, input.credentials, input.options ?? {});
      await repository.fetch();
      return repository;
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  private remote(args: readonly string[], input?: Uint8Array): Promise<GitOutput> {
    return runGit({
      path: this.path,
      args,
      remoteUrl: this.url,
      ...(this.credentials ? { credentials: this.credentials } : {}),
      options: this.options,
      ...(input ? { input } : {}),
    });
  }

  private local(args: readonly string[], input?: Uint8Array): Promise<GitOutput> {
    return runGit({ path: this.path, args, ...(input ? { input } : {}) });
  }

  async fetch(): Promise<void> {
    const advertised = await this.remote(["ls-remote", "--heads", "--tags", this.url]);
    if (!advertised.text) return;
    await this.remote([
      "fetch", "--prune", "--force", "--no-write-fetch-head", this.url,
      "+refs/heads/*:refs/remotes/origin/*",
      "+refs/tags/*:refs/tags/*",
    ]);
    await this.local(["fsck", "--strict", "--no-reflogs"]);
  }

  async branches(): Promise<ReadonlyMap<string, string>> {
    const output = await this.local([
      "for-each-ref", "--format=%(objectname) %(refname)", "refs/remotes/origin/",
    ]);
    return parseRefs(output.text, "refs/remotes/origin/");
  }

  async tags(): Promise<ReadonlyMap<string, string>> {
    const output = await this.local([
      "for-each-ref", "--format=%(objectname) %(refname)", "refs/tags/",
    ]);
    return parseRefs(output.text, "refs/tags/");
  }

  async head(branch: string): Promise<string> {
    const branches = await this.branches();
    const head = branches.get(branch);
    if (!head) throw new ServiceError("REMOTE_BRANCH_NOT_FOUND", 404, "Remote branch does not exist");
    return head;
  }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    try {
      await this.local(["merge-base", "--is-ancestor", ancestor, descendant]);
      return true;
    } catch (error) {
      if (error instanceof ServiceError && error.code === "REMOTE_GIT_FAILED") return false;
      throw error;
    }
  }

  async pack(): Promise<Uint8Array> {
    const refs = [...(await this.branches()).values(), ...(await this.tags()).values()];
    if (refs.length === 0) throw new ServiceError("REMOTE_REPOSITORY_EMPTY", 422, "Remote repository has no branches or tags");
    return (await this.local(["pack-objects", "--stdout", "--revs"],
      new TextEncoder().encode(`${refs.join("\n")}\n`))).bytes;
  }

  async files(commit: string): Promise<readonly { readonly path: string; readonly bytes: Uint8Array }[]> {
    const listing = await this.local(["ls-tree", "-rz", "--full-tree", commit]);
    const records = listing.text.split("\0").filter(Boolean).map((entry) => {
      const match = /^(\d+) ([^ ]+) ([0-9a-f]{40})\t(.+)$/.exec(entry);
      if (!match) throw new ServiceError("REMOTE_TREE_INVALID", 422, "Remote tree entry is invalid");
      return treeRowSchema.parse({ mode: match[1], kind: match[2], oid: match[3], path: match[4] });
    });
    const files: { readonly path: string; readonly bytes: Uint8Array }[] = [];
    for (const record of records) {
      if (record.mode === "160000") {
        throw new ServiceError("REMOTE_SUBMODULE_UNSUPPORTED", 422, "Git submodules must be removed before import");
      }
      if (record.mode === "120000") {
        throw new ServiceError("REMOTE_SYMLINK_UNSUPPORTED", 422, "Git symlinks must be replaced by regular files before import");
      }
      if (record.kind !== "blob") continue;
      const bytes = (await this.local(["cat-file", "blob", record.oid])).bytes;
      if (new TextDecoder().decode(bytes.slice(0, 128)).startsWith("version https://git-lfs.github.com/spec/v1")) {
        throw new ServiceError("REMOTE_LFS_UNSUPPORTED", 422, "Git LFS objects must be materialized before import");
      }
      files.push({ path: record.path, bytes });
    }
    return files;
  }

  async importBundle(bundle: Uint8Array): Promise<void> {
    if (bundle.byteLength === 0) {
      throw new ServiceError("LOCAL_REPOSITORY_EMPTY", 422, "Quire repository has no named branches");
    }
    const path = join(this.root, "named.bundle");
    await writeFile(path, bundle);
    const listed = await this.local(["bundle", "unbundle", path]);
    const updates = listed.text.split("\n").filter(Boolean).map((line) => {
      const separator = line.indexOf(" ");
      const oid = oidSchema.parse(line.slice(0, separator));
      const ref = z.string().startsWith("refs/heads/").parse(line.slice(separator + 1));
      return `update ${ref} ${oid}`;
    });
    await this.local(["update-ref", "--stdin"], new TextEncoder().encode(
      ["start", ...updates, "prepare", "commit", ""].join("\n"),
    ));
  }

  async push(input: { readonly source: string; readonly destination: string; readonly expected?: string }): Promise<void> {
    await this.remote([
      "push", "--porcelain",
      ...(input.expected ? [`--force-with-lease=${input.destination}:${input.expected}`] : []),
      this.url, `${input.source}:${input.destination}`,
    ]);
  }

  oid(value: string): GitOid {
    return GitOidSchema.parse(`sha1:${oidSchema.parse(value)}`);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}
