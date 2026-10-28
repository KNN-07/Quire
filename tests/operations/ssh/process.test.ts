import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { runGitSession } from "../../../services/operations/ssh/process";
import { renderSshdConfig } from "../../../services/operations/ssh";
import { bounded, checked } from "./commands";

test("terminates and awaits an actual Git process when its SSH channel is aborted", async () => {
  // Given: a bare repository and exact ready/advertisement signals registered before Git starts.
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-ssh-process-"));
  try {
    await checked(["git", "init", "--bare", "--initial-branch=main", root]);
    const ready = Promise.withResolvers<void>();
    const advertised = Promise.withResolvers<void>();
    const abort = new AbortController();
    const running = runGitSession(root, "git-upload-pack", {
      signal: abort.signal, ready: () => ready.resolve(),
      send: () => advertised.resolve(), stderr: () => advertised.resolve(),
    });
    const outcome = running.then(() => null, (error: unknown) => error);
    await bounded(Promise.all([ready.promise, advertised.promise]));
    // When: the SSH transport disconnects an already-running upload-pack.
    abort.abort();
    // Then: the process close is awaited and the caller receives the typed abort reason.
    const result = await bounded(outcome);
    expect(result).toMatchObject({ code: "SSH_SESSION_ABORTED" });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("validates a separate real sshd configuration when only owned host keys are provisioned", async () => {
  // Given: a disposable host key, high port, and no modification to system SSH files.
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-ssh-config-"));
  try {
    const hostKey = join(root, "host");
    await checked(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", hostKey]);
    const config = join(root, "sshd_config");
    await writeFile(config, renderSshdConfig({
      user: userInfo().username, port: 33023, hostKey,
      pidFile: join(root, "sshd.pid"), clientFile: join(root, "client.json"),
      bun: process.execPath, cli: join(process.cwd(), "scripts/ops/ssh.ts"),
    }));
    // When: the installed OpenSSH parser checks the complete configuration.
    const output = await checked(["/usr/sbin/sshd", "-t", "-f", config]);
    // Then: that actual installed daemon accepts the configuration and host key.
    expect(output).toBe("");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("terminates Git with the input-limit error when a session exceeds its byte budget", async () => {
  // Given: a real Git service and an input callback installed before the oversized input.
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-ssh-limit-"));
  try {
    await checked(["git", "init", "--bare", "--initial-branch=main", root]);
    const running = runGitSession(root, "git-receive-pack", {
      signal: new AbortController().signal, send: () => undefined, stderr: () => undefined,
      ready: input => input(new Uint8Array(50 * 1024 * 1024 + 1)),
    });
    // When: the actual service encounters more than the transport's 50 MiB limit.
    const outcome: unknown = await bounded(running.then(() => null, (error: unknown) => error));
    // Then: failure is caused by the byte boundary, not incidental Git syntax rejection.
    expect(outcome).toMatchObject({ code: "SSH_INPUT_LIMIT" });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
