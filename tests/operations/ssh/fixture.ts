import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, userInfo } from "node:os";
import { z } from "zod";
import { createRuntime, loadConfig, systemClock } from "@quire/runtime";
import { ProjectSchema, UserSchema } from "@quire/contracts";
import { CoreProjects } from "../../../services/core/base";
import { GitRepository, serveGitSession } from "../../../services/core/git";
import { createSshRuntime, sshModules, startSshBridge, renderSshdConfig, shellQuote } from "../../../services/operations/ssh";
import { seed } from "../../../scripts/seed";
import { checked, command, ServiceProcess } from "./commands";
import { remoteAdapters } from "./remote";

const password = "quire-ssh-fixture-password";

export async function sshFixture(remote = false, afterRun?: () => Promise<void>, deployed = false) {
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-ssh-"));
  let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
  let bridge: Awaited<ReturnType<typeof startSshBridge>> | undefined;
  let daemon: ServiceProcess | undefined;
  const cleanup = async () => {
    try { if (bridge) await bridge.close(); }
    finally {
      try { if (daemon) await daemon.close(); }
      finally {
        try { if (runtime) await runtime.close(); }
        finally {
          await rm(root, { recursive: true, force: true });
          console.info("SSH_FIXTURE_CLEANED", { root, sshdPid: daemon?.child.pid, remote });
        }
      }
    }
  };
  try {
    const config = loadConfig({ QUIRE_DATA_DIR: join(root, "api") });
    const instance = remote ? await createRuntime(config, { modules: sshModules,
      createAdapters: (_config, clock) => remoteAdapters(root, clock, sshModules.flatMap(item => item.migrations ?? [])),
      clock: systemClock }) : await createSshRuntime(config);
    runtime = instance;
    await seed(instance, password);
    const projects = instance.services.get("projects");
    if (!(projects instanceof CoreProjects)) throw new TypeError("Expected real project service");
    const clientFile = join(root, "client.json");
    const secret = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    let activeBridge: { readonly url: string; close(): Promise<void> };
    if (deployed) {
      const reservation = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      const url = `http://127.0.0.1:${reservation.port}/`;
      reservation.stop(true);
      await writeFile(clientFile, JSON.stringify({ url, token: secret }), { mode: 0o600 });
      const brokerProcess = new ServiceProcess([process.execPath, "scripts/ops/ssh.ts", "serve", clientFile],
        /QUIRE_SSH_READY http:\/\/127\.0\.0\.1:\d+\//,
        { ...process.env, QUIRE_PROFILE: config.profile, QUIRE_DATA_DIR: config.dataDir });
      activeBridge = { url, close: () => brokerProcess.close() };
      bridge = activeBridge;
      await brokerProcess.ready;
    } else {
      activeBridge = await startSshBridge(new GitRepository(projects), {
        token: secret, clientFile, command: [process.execPath, join(process.cwd(), "scripts/ops/ssh.ts")],
        session: (repo, input) => serveGitSession(repo, { ...input, run: async (path: string) => {
          await input.run(path);
          await afterRun?.();
        } }),
      });
    }
    bridge = activeBridge;
    await writeFile(clientFile, JSON.stringify({ url: activeBridge.url, token: secret }), { mode: 0o600 });
    const host = join(root, "host");
    const key = join(root, "identity");
    await checked(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", host]);
    await checked(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", key]);
    const reservation = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = reservation.port;
    reservation.stop(true);
    const serviceUser = userInfo().username;
    const sshdConfig = join(root, "sshd_config");
    await writeFile(sshdConfig, renderSshdConfig({ user: serviceUser, port, hostKey: host, pidFile: join(root, "sshd.pid"),
      clientFile, bun: process.execPath, cli: join(process.cwd(), "scripts/ops/ssh.ts") }));
    await checked(["/usr/sbin/sshd", "-t", "-f", sshdConfig]);
    daemon = new ServiceProcess(["/usr/sbin/sshd", "-D", "-e", "-f", sshdConfig], /Server listening on 127\.0\.0\.1 port \d+/);
    await daemon.ready;
    const knownHosts = join(root, "known_hosts");
    await writeFile(knownHosts, `[127.0.0.1]:${port} ${await readFile(host + ".pub", "utf8")}`);
    const sshArgs = ["ssh", "-F", "/dev/null", "-p", String(port), "-i", key,
      "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHosts}`,
      "-o", "GlobalKnownHostsFile=/dev/null", "-o", "ConnectTimeout=5"];
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_SSH_COMMAND: sshArgs.map(shellQuote).join(" "), GIT_SSH_VARIANT: "ssh" };
    const request = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("origin", "http://localhost:5173");
      if (init.body) headers.set("content-type", "application/json");
      return instance.routes.fetch(new Request(`http://localhost:3001${path}`, { ...init, headers }));
    };
    async function login(email = "kien@quire.local") {
      const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      const user = z.object({ data: UserSchema }).parse(await response.json()).data;
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      if (!cookie) throw new TypeError("Expected authenticated session");
      const me = await request("/api/me", { headers: { cookie } });
      const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
      return { user, headers: { cookie, "x-csrf-token": csrf, "idempotency-key": crypto.randomUUID() } };
    }
    async function registerKey(headers: HeadersInit) {
      const response = await request("/api/me/ssh-keys", { method: "POST", headers,
        body: JSON.stringify({ name: "Owned SSH fixture", publicKey: (await readFile(key + ".pub", "utf8")).trim() }) });
      return z.object({ data: z.object({ id: z.string(), version: z.number() }) }).parse(await response.json()).data;
    }
    async function create(headers: HeadersInit) {
      const response = await request("/api/projects", { method: "POST", headers,
        body: JSON.stringify({ name: "Actual SSH project", origin: { kind: "blank" } }) });
      return z.object({ data: ProjectSchema }).parse(await response.json()).data;
    }
    console.info("SSH_LISTENING", { root, port, sshdPid: daemon.child.pid, broker: activeBridge.url, remote });
    return {
      root, runtime: instance, projects, request, login, registerKey, create,
      url: (projectId: string) => `ssh://${serviceUser}@127.0.0.1:${port}/${projectId}.git`,
      git: (args: readonly string[], cwd = root) => command(["git", "-c", "core.hooksPath=/dev/null", ...args], { env, cwd }),
      ssh: (args: readonly string[]) => command([...sshArgs, `${serviceUser}@127.0.0.1`, ...args]),
      async [Symbol.asyncDispose]() { await cleanup(); },
    };
  } catch (error) { await cleanup(); throw error; }
}
