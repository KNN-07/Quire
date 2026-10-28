import { z } from "zod";
import { shellQuote } from "./protocol";

const absolutePath = z.string().startsWith("/").regex(/^[^\s"'\\\0]+$/);
const configSchema = z.strictObject({
  user: z.string().regex(/^[a-z_][a-z0-9_-]*$/),
  port: z.number().int().min(1024).max(65535),
  hostKey: absolutePath,
  pidFile: absolutePath,
  clientFile: absolutePath,
  bun: absolutePath,
  cli: absolutePath,
});
export type SshdConfig = z.infer<typeof configSchema>;

/** A separate service, never an include in the machine's ordinary sshd. */
export function renderSshdConfig(input: SshdConfig): string {
  const config = configSchema.parse(input);
  const command = [config.bun, config.cli, "keys", config.clientFile].map(shellQuote).join(" ");
  return `ListenAddress 127.0.0.1
Port ${config.port}
HostKey ${config.hostKey}
PidFile ${config.pidFile}
AllowUsers ${config.user}
AuthorizedKeysFile none
AuthorizedKeysCommand /usr/bin/env ${command} %f
AuthorizedKeysCommandUser ${config.user}
AuthenticationMethods publickey
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
HostbasedAuthentication no
UsePAM no
PermitRootLogin no
PermitTTY no
PermitUserRC no
PermitUserEnvironment no
DisableForwarding yes
PermitTunnel no
X11Forwarding no
MaxSessions 1
MaxStartups 10:30:30
MaxAuthTries 3
LoginGraceTime 15
ClientAliveInterval 15
ClientAliveCountMax 2
ChannelTimeout session=120s
PrintMotd no
PrintLastLog no
LogLevel VERBOSE
`;
}
