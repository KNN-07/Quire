import { spawn } from "node:child_process";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { once } from "node:events";
import { existsSync } from "node:fs";

// This wrapper always delegates to real Git. Its socket controls exact execution
// barriers and lost-result failures, never fabricated Git success.
const args = process.argv.slice(2);
const path = args[args.indexOf("--git-dir") + 1];
if (!path) throw new Error("Git directory missing");
const parent = dirname(path);
const socketPath = existsSync(join(parent, ".probe.sock")) ? join(parent, ".probe.sock") : join(dirname(parent), ".probe.sock");
const socket = connect(socketPath);
await once(socket, "connect");
const instruction = new Promise<string>((resolve, reject) => {
  socket.once("data", (data: Buffer) => resolve(data.toString().trim()));
  socket.once("error", reject);
});
socket.write(JSON.stringify({ args, pid: process.pid }) + "\n");
const mode = await instruction;
if (mode === "fail-before") { socket.end(); process.exit(71); }
const child = spawn("/usr/bin/git", args, { stdio: [0, 1, 2, 3] });
const code = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (status) => resolve(status ?? 1));
});
socket.end();
process.exit(mode === "fail-after" ? 72 : code);
