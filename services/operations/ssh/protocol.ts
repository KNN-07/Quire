import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";

export const fingerprintSchema = z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/);
export const serviceSchema = z.enum(["git-upload-pack", "git-receive-pack"]);
export const clientSchema = z.strictObject({
  url: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1"
      && Number(url.port) >= 1024 && Number(url.port) <= 65535
      && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
  }, "The SSH broker must be on IPv4 loopback"),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SshClient = z.infer<typeof clientSchema>;
export type GitService = z.infer<typeof serviceSchema>;
export const controlSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ready") }),
  z.strictObject({ type: z.literal("stderr"), text: z.string() }),
  z.strictObject({ type: z.literal("exit"), code: z.number().int().min(0).max(255) }),
]);

/** Accept Git's single quoted repository argument, never shell syntax or paths. */
export function parseCommand(command: string) {
  const match = /^(git-upload-pack|git-receive-pack) '\/?([0-9a-f-]+)\.git'$/.exec(command);
  if (!match) throw new ServiceError("SSH_COMMAND_DENIED", 403, "Only a Quire Git repository command is allowed");
  return { service: serviceSchema.parse(match[1]), projectId: IdSchema.parse(match[2]) };
}

export function shellQuote(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new ServiceError("SSH_CONFIG_INVALID", 422, "Invalid command argument");
  return `'${value.replaceAll("'", "'\\''")}'`;
}
