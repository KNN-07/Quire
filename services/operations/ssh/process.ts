import { spawn } from "node:child_process";
import { ServiceError } from "@quire/runtime";
import type { GitService } from "./protocol";

export type GitChannel = {
  readonly send: (bytes: Uint8Array) => void;
  readonly stderr: (text: string) => void;
  readonly ready: (input: (bytes: Uint8Array | null) => void) => void;
  readonly signal: AbortSignal;
};

/** One process group per session, including index-pack descendants. */
export async function runGitSession(
  path: string,
  service: GitService,
  channel: GitChannel,
): Promise<readonly Uint8Array[]> {
  const child = spawn("git", ["--git-dir", path,
    "-c", "core.hooksPath=/dev/null",
    "-c", "transfer.hideRefs=refs/quire/",
    "-c", "receive.hideRefs=refs/quire/",
    "-c", "receive.fsckObjects=true",
    "-c", "receive.maxInputSize=52428800",
    "-c", "uploadpack.allowAnySHA1InWant=false",
    "-c", "uploadpack.allowReachableSHA1InWant=false",
    "-c", "uploadpack.allowTipSHA1InWant=false",
    "-c", "uploadpack.allowFilter=false",
    service.slice(4), path], {
    cwd: path, detached: true, stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: process.env["PATH"], GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  });
  let inputBytes = 0;
  let outputBytes = 0;
  let receivedInput = false;
  let failure: Error | undefined;
  const delayed: Uint8Array[] = [];
  const kill = () => {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
      }
    }
  };
  const abort = () => { failure = new ServiceError("SSH_SESSION_ABORTED", 409, "SSH session aborted"); kill(); };
  const timer = setTimeout(() => {
    failure = new ServiceError("SSH_SESSION_TIMEOUT", 408, "SSH Git exceeded 120 seconds");
    kill();
  }, 120_000);
  const done = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => resolve(code ?? 255));
  });
  child.stdin.on("error", error => { failure ??= error; kill(); });
  child.stdout.on("data", (bytes: Buffer) => {
    outputBytes += bytes.byteLength;
    if (outputBytes > 64 * 1024 * 1024) {
      failure = new ServiceError("SSH_OUTPUT_LIMIT", 413, "SSH output exceeds 64 MiB"); kill(); return;
    }
    // Git's advertisement must flow first. Push report-status waits for fenced publication.
    if (service === "git-receive-pack" && receivedInput) delayed.push(new Uint8Array(bytes));
    else channel.send(bytes);
  });
  child.stderr.on("data", (bytes: Buffer) => {
    outputBytes += bytes.byteLength;
    if (outputBytes > 64 * 1024 * 1024) {
      failure = new ServiceError("SSH_OUTPUT_LIMIT", 413, "SSH output exceeds 64 MiB"); kill(); return;
    }
    channel.stderr(bytes.toString("utf8"));
  });
  channel.signal.addEventListener("abort", abort, { once: true });
  if (channel.signal.aborted) abort();
  channel.ready(bytes => {
    if (bytes === null) { child.stdin.end(); return; }
    receivedInput = true;
    inputBytes += bytes.byteLength;
    if (inputBytes > 50 * 1024 * 1024) {
      failure = new ServiceError("SSH_INPUT_LIMIT", 413, "SSH input exceeds 50 MiB"); kill(); return;
    }
    child.stdin.write(bytes);
  });
  try {
    const code = await done;
    if (failure) throw failure;
    if (code !== 0) throw new ServiceError("SSH_GIT_FAILED", 409, `Git exited ${code}`);
    return delayed;
  } finally {
    clearTimeout(timer);
    channel.signal.removeEventListener("abort", abort);
    kill();
  }
}
