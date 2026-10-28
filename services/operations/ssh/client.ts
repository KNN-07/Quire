import { readFile, stat } from "node:fs/promises";
import ky from "ky";
import { assertNever } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { clientSchema, controlSchema, fingerprintSchema, parseCommand } from "./protocol";

export async function readClient(path: string) {
  const info = await stat(path);
  if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
    throw new ServiceError("SSH_CLIENT_PERMISSIONS", 403, "SSH client file must be owned by this user with mode 0600");
  }
  return clientSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function authorizedKey(path: string, fingerprint: string): Promise<string> {
  const config = await readClient(path);
  const url = new URL("/keys", config.url);
  url.searchParams.set("fingerprint", fingerprintSchema.parse(fingerprint));
  return ky.get(url, { headers: { authorization: `Bearer ${config.token}` },
    timeout: 5000, retry: 0 }).text();
}

export async function forcedSession(path: string, fingerprint: string, command: string): Promise<number> {
  parseCommand(command);
  const config = await readClient(path);
  const url = new URL("/session", config.url);
  url.protocol = "ws:";
  url.searchParams.set("fingerprint", fingerprintSchema.parse(fingerprint));
  url.searchParams.set("command", command);
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, ["quire", config.token]);
    socket.binaryType = "arraybuffer";
    let exit: number | undefined;
    let started = false;
    let inputBytes = 0;
    const timer = setTimeout(() => { socket.close(); reject(new ServiceError("SSH_TIMEOUT", 408, "SSH bridge timed out")); }, 125_000);
    const input = (bytes: Buffer) => {
      inputBytes += bytes.byteLength;
      if (inputBytes > 50 * 1024 * 1024 || socket.bufferedAmount > 4 * 1024 * 1024) {
        socket.close(); return;
      }
      socket.send(bytes);
    };
    const eof = () => { if (socket.readyState === WebSocket.OPEN) socket.send("eof"); };
    socket.onmessage = event => {
      if (event.data instanceof ArrayBuffer) { process.stdout.write(new Uint8Array(event.data)); return; }
      if (typeof event.data !== "string") { socket.close(); return; }
      const message = controlSchema.parse(JSON.parse(event.data));
      switch (message.type) {
        case "ready":
          if (!started) {
            started = true;
            process.stdin.on("data", input);
            process.stdin.once("end", eof);
            process.stdin.resume();
          }
          break;
        case "stderr": process.stderr.write(message.text); break;
        case "exit": exit = message.code; socket.close(); break;
        default: assertNever(message);
      }
    };
    socket.onerror = () => { reject(new ServiceError("SSH_UNAVAILABLE", 503, "SSH bridge unavailable")); };
    socket.onclose = () => {
      clearTimeout(timer);
      process.stdin.off("data", input);
      process.stdin.off("end", eof);
      process.stdin.pause();
      resolve(exit ?? 1);
    };
  });
}
