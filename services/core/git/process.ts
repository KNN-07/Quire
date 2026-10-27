import { ServiceError } from "@quire/runtime";
import { GitOidSchema, IdSchema } from "@quire/contracts";

export const zero = "0".repeat(40);
export const oid = (value: string) => GitOidSchema.parse(`sha1:${value}`);
export const raw = (value: string) => value.replace(/^sha1:/, "");
export function stableId(value: string) {
  const hex = new Bun.CryptoHasher("sha256").update(value).digest("hex");
  return IdSchema.parse(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`);
}
export type GitCommand = {
  readonly path: string; readonly args: readonly string[]; readonly input?: Uint8Array;
  readonly env?: Readonly<Record<string, string>>; readonly allowed?: readonly number[];
};
export async function run(command: GitCommand) {
  const child = Bun.spawn(["git", "--git-dir", command.path, "-c", "core.hooksPath=/dev/null",
    "-c", "protocol.file.allow=always", ...command.args], {
    stdin: command.input ? new Blob([new Uint8Array(command.input)]) : "ignore",
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0", ...command.env },
  });
  const [bytes, error, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited,
  ]);
  if (!(command.allowed ?? [0]).includes(code)) throw new ServiceError("GIT_FAILED", 409, error.trim());
  const output = new Uint8Array(bytes);
  return { bytes: output, text: new TextDecoder().decode(output).trimEnd(), code };
}
export const encode = (value: string) => new TextEncoder().encode(value);
export async function branchName(path: string, name: string): Promise<void> {
  await run({ path, args: ["check-ref-format", `refs/heads/${name}`] });
}
