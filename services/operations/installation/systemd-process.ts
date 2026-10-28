import { dlopen, FFIType, ptr } from "bun:ffi";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, readlink, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { Socket } from "node:net";
import { z } from "zod";
import { ControlError } from "./model";
import type { SystemdDriverConfig } from "./driver-config";
import { controlDigest } from "./protocol";

const libc = dlopen("libc.so.6", {
  getsockopt: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
export interface PeerIdentity { readonly pid: number; readonly uid: number; readonly gid: number }
export function socketPeer(socket: Socket): PeerIdentity {
  const fd = z.object({ _handle: z.object({ fd: z.number().int().nonnegative() }) }).parse(socket)["_handle"].fd;
  const bytes = new Int32Array(3);
  const length = new Uint32Array([12]);
  if (libc.symbols.getsockopt(fd, 1, 17, ptr(bytes), ptr(length)) !== 0 || length[0] !== 12) {
    throw new ControlError("CONTROL_PEER_UNAVAILABLE");
  }
  const [pid, uid, gid] = bytes;
  return z.object({ pid: z.number().int().nonnegative(), uid: z.number().int().nonnegative(), gid: z.number().int().nonnegative() })
    .parse({ pid, uid, gid });
}
export interface ProcessIdentity extends PeerIdentity {
  readonly startTime: string; readonly executable: string; readonly executableDigest: string;
  readonly cgroup: string; readonly command: readonly string[];
}
export async function processIdentity(peer: PeerIdentity): Promise<ProcessIdentity> {
  if (peer.pid <= 0) throw new ControlError("CONTROL_PEER_UNAVAILABLE");
  const root = `/proc/${peer.pid}`;
  const before = await readFile(join(root, "stat"), "utf8");
  const fields = before.slice(before.lastIndexOf(")") + 2).split(" ");
  const startTime = z.string().regex(/^\d+$/).parse(fields[19]);
  const info = await lstat(root);
  const cgroup = (await readFile(join(root, "cgroup"), "utf8")).trim().split("\n")
    .find(line => line.startsWith("0::"))?.slice(3);
  if (info.uid !== peer.uid || !cgroup?.startsWith("/")) throw new ControlError("CONTROL_PROCESS_UNPROVEN");
  const executable = await readlink(join(root, "exe"));
  const executableDigest = controlDigest(await readFile(join(root, "exe")));
  const argumentsList = (await readFile(join(root, "cmdline"), "utf8")).split("\0").filter(Boolean);
  const after = await readFile(join(root, "stat"), "utf8");
  if (after.slice(after.lastIndexOf(")") + 2).split(" ")[19] !== startTime) {
    throw new ControlError("CONTROL_PROCESS_CHANGED");
  }
  return { ...peer, startTime, executable, executableDigest, cgroup, command: argumentsList };
}
export function spawnManager(config: SystemdDriverConfig, argv: readonly string[]) {
  return Bun.spawn([...argv], {
    env: { PATH: "/usr/bin:/bin", HOME: process.env["HOME"], XDG_RUNTIME_DIR: config.userRuntimeDir,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${config.userRuntimeDir}/bus`, LC_ALL: "C" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
}
export async function command(config: SystemdDriverConfig, argv: readonly string[]): Promise<string> {
  const child = spawnManager(config, argv);
  const timer = setTimeout(() => child.kill("SIGKILL"), config.requestTimeoutMs);
  try {
    const [out, error, status] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (out.length + error.length > 1_048_576) throw new ControlError("CONTROL_MANAGER_RESPONSE_LIMIT");
    if (status !== 0) throw new ControlError("CONTROL_MANAGER_FAILED", `${argv[0]}: ${error.trim()}`);
    return out.trim();
  } finally { clearTimeout(timer); }
}
export interface UnitIdentity {
  readonly unit: string; readonly invocationId: string; readonly cgroup: string;
  readonly state: string; readonly mainPid: number; readonly bindsTo: readonly string[];
  readonly killMode: string; readonly sendSigkill: string; readonly restart: string;
  readonly result: string; readonly exitCode: number; readonly exitStatus: number;
}
export async function inspectUnit(config: SystemdDriverConfig, unit: string): Promise<UnitIdentity> {
  const values = new Map((await command(config, ["/usr/bin/systemctl", "--user", "show", unit,
    "--property=Id,InvocationID,ControlGroup,ActiveState,MainPID,BindsTo,KillMode,SendSIGKILL,Restart,Result,ExecMainCode,ExecMainStatus",
  ])).split("\n").map(line => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1)];
  }));
  if (values.get("Id") !== unit) throw new ControlError("CONTROL_UNIT_MISMATCH");
  return {
    unit, invocationId: values.get("InvocationID") ?? "", cgroup: values.get("ControlGroup") ?? "",
    state: values.get("ActiveState") ?? "", mainPid: Number(values.get("MainPID") ?? 0),
    bindsTo: (values.get("BindsTo") ?? "").split(" ").filter(Boolean),
    killMode: values.get("KillMode") ?? "", sendSigkill: values.get("SendSIGKILL") ?? "",
    restart: values.get("Restart") ?? "",
    result: values.get("Result") ?? "", exitCode: Number(values.get("ExecMainCode") ?? 0),
    exitStatus: Number(values.get("ExecMainStatus") ?? 0),
  };
}
export async function cgroupPids(cgroup: string): Promise<readonly number[]> {
  if (!cgroup.startsWith("/") || cgroup.includes("..") || cgroup === "/") {
    throw new ControlError("CONTROL_CGROUP_INVALID");
  }
  const root = `/sys/fs/cgroup${cgroup}`;
  const pids: number[] = [];
  async function visit(path: string): Promise<void> {
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || await realpath(path) !== path) throw new ControlError("CONTROL_CGROUP_INVALID");
      const bytes = await readFile(join(path, "cgroup.procs"), "utf8");
      pids.push(...bytes.trim().split("\n").filter(Boolean).map(value => z.coerce.number().int().positive().parse(value)));
      for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await visit(join(path, entry.name));
    } catch (error) {
      if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success) return;
      throw error;
    }
  }
  await visit(root);
  return [...new Set(pids)];
}
export async function controllerLock(path: string): Promise<FileHandle> {
  const file = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new ControlError("CONTROL_LOCK_UNSAFE");
    const child = Bun.spawn(["/usr/bin/flock", "--exclusive", "--nonblock", "0"],
      { stdin: file.fd, stdout: "ignore", stderr: "ignore" });
    if (await child.exited !== 0) throw new ControlError("CONTROL_ALREADY_RUNNING");
    return file;
  } catch (error) { await file.close(); throw error; }
}
