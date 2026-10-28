import { timingSafeEqual } from "node:crypto";
import type { ServerWebSocket } from "bun";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { sshActor, sshFingerprint } from "../../core/git";
import type { GitRepository } from "../../core/git";
import { clientSchema, fingerprintSchema, parseCommand, shellQuote } from "./protocol";
import type { GitService } from "./protocol";
import { runGitSession } from "./process";

export type GitSession = (repo: GitRepository, input: {
  readonly fingerprint: string; readonly projectId: Id; readonly service: GitService;
  readonly run: (path: string) => Promise<void>;
}) => Promise<void>;
export type SshBridgeOptions = {
  readonly token: string; readonly clientFile: string; readonly command: readonly string[];
  readonly session: GitSession; readonly port?: number;
};
type Connection = {
  readonly fingerprint: string; readonly command: string; readonly abort: AbortController;
  input?: (bytes: Uint8Array | null) => void;
};

export async function startSshBridge(repo: GitRepository, options: SshBridgeOptions) {
  const credential = Buffer.from(`Bearer ${clientSchema.shape.token.parse(options.token)}`);
  const pending = new Set<Promise<void>>();
  const connections = new Set<ServerWebSocket<Connection>>();
  const authorized = (request: Request) => {
    const protocols = request.headers.get("sec-websocket-protocol")?.split(",").map(value => value.trim());
    const supplied = Buffer.from(request.headers.get("authorization")
      ?? (protocols?.[0] === "quire" ? `Bearer ${protocols[1] ?? ""}` : ""));
    return supplied.length === credential.length && timingSafeEqual(supplied, credential);
  };
  const server = Bun.serve<Connection>({
    hostname: "127.0.0.1", port: options.port ?? 0, maxRequestBodySize: 4096,
    fetch(request, listener) {
      if (!authorized(request)) return new Response(null, { status: 401 });
      const url = new URL(request.url);
      const fingerprint = fingerprintSchema.safeParse(url.searchParams.get("fingerprint"));
      if (!fingerprint.success) return new Response(null, { status: 400 });
      if (request.method === "GET" && url.pathname === "/keys") {
        return (async () => {
          if (!await sshActor(repo.service.context, fingerprint.data)) return new Response("");
          const row = await repo.service.context.db.get<{ public_key: string }>(
            "SELECT public_key FROM ssh_keys WHERE fingerprint=?", [fingerprint.data]);
          if (!row || await sshFingerprint(row.public_key) !== fingerprint.data) return new Response("");
          const command = [...options.command, "session", options.clientFile, fingerprint.data].map(shellQuote).join(" ");
          const escaped = command.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
          return new Response(`restrict,command="${escaped}" ${row.public_key}\n`, {
            headers: { "cache-control": "no-store" },
          });
        })();
      }
      if (request.method !== "GET" || url.pathname !== "/session") return new Response(null, { status: 404 });
      if (connections.size >= 16) return new Response(null, { status: 503 });
      const command = url.searchParams.get("command") ?? "";
      try { parseCommand(command); }
      catch (error) {
        if (error instanceof Error) return new Response("SSH command denied", { status: 403 });
        throw error;
      }
      // Keep upgrade synchronous on native Bun 1.3.14. Core authenticates before running Git.
      return listener.upgrade(request, { headers: { "sec-websocket-protocol": "quire" },
        data: { fingerprint: fingerprint.data, command, abort: new AbortController() } })
        ? undefined : new Response(null, { status: 400 });
    },
    websocket: {
      maxPayloadLength: 1024 * 1024, idleTimeout: 120,
      backpressureLimit: 4 * 1024 * 1024, closeOnBackpressureLimit: true,
      open(socket) {
        connections.add(socket);
        const control = (value: unknown) => { socket.send(JSON.stringify(value)); };
        const work = (async () => {
          try {
            const input = parseCommand(socket.data.command);
            let delayed: readonly Uint8Array[] = [];
            await options.session(repo, { ...input, fingerprint: socket.data.fingerprint, run: async path => {
              try {
                delayed = await runGitSession(path, input.service, {
                  send: bytes => { socket.sendBinary(bytes); },
                  stderr: text => control({ type: "stderr", text }),
                  ready: receive => { socket.data.input = receive; control({ type: "ready" }); },
                  signal: socket.data.abort.signal,
                });
              } finally { delete socket.data.input; }
            } });
            if (socket.data.abort.signal.aborted) throw new ServiceError("SSH_CLOSED", 409, "SSH connection closed");
            for (const bytes of delayed) socket.sendBinary(bytes);
            control({ type: "exit", code: 0 });
          } catch (error) {
            const text = error instanceof ServiceError ? `${error.code}: ${error.message}` : "SSH Git session failed";
            control({ type: "stderr", text: `${text}\n` });
            control({ type: "exit", code: 1 });
          }
        })();
        pending.add(work);
        void work.finally(() => pending.delete(work));
      },
      message(socket, message) {
        if (typeof message === "string") {
          if (message === "eof") socket.data.input?.(null);
          else socket.terminate();
        } else if (socket.data.input) socket.data.input(message);
        else socket.terminate();
      },
      close(socket) {
        socket.data.abort.abort();
        delete socket.data.input;
        connections.delete(socket);
        socket.terminate();
      },
    },
  });
  return {
    url: server.url.toString(),
    async close() {
      for (const socket of connections) { socket.data.abort.abort(); socket.terminate(); }
      await Promise.allSettled(pending);
      await server.stop(true);
    },
  };
}
