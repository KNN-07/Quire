import { createConnection, isIP } from "node:net";
import { connect as connectTls } from "node:tls";
import { InstantSchema } from "@quire/contracts";
import type { Instant } from "@quire/contracts";
import { dotStuff, smtpContent } from "./message";
import type { OutboxMessage } from "./message";
import type { SmtpSettings } from "./configuration";
import { ready, requireCode, SmtpChannel, SmtpTransportError } from "./smtp-channel";
import type { SmtpAttempt, SmtpSocket } from "./smtp-channel";

export class SmtpClient {
  constructor(private readonly timeoutMs = 15_000) {}

  async probe(settings: SmtpSettings): Promise<SmtpAttempt> {
    return this.session(settings, null, InstantSchema.parse(new Date().toISOString()));
  }

  async send(settings: SmtpSettings, message: OutboxMessage, at: Instant): Promise<SmtpAttempt> {
    return this.session(settings, message, at);
  }

  private async session(
    settings: SmtpSettings,
    message: OutboxMessage | null,
    at: Instant,
  ): Promise<SmtpAttempt> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let socket: SmtpSocket | undefined;
    try {
      socket =
        settings.tls === "implicit"
          ? connectTls({
              host: settings.host,
              port: settings.port,
              ...(isIP(settings.host) === 0 ? { servername: settings.host } : {}),
              rejectUnauthorized: true,
              minVersion: "TLSv1.2",
              ...(settings.ca === undefined ? {} : { ca: settings.ca }),
            })
          : createConnection({ host: settings.host, port: settings.port });
      await ready(socket, settings.tls === "implicit" ? "secureConnect" : "connect", signal);
      let channel = new SmtpChannel(socket);
      let failure = requireCode(await channel.reply(signal), [220]);
      if (failure) return failure;
      let ehlo = await channel.command(`EHLO ${settings.ehloName}`, signal);
      failure = requireCode(ehlo, [250]);
      if (failure) return failure;
      if (settings.tls === "starttls") {
        if (!ehlo.lines.some((line) => line.toUpperCase().startsWith("STARTTLS"))) {
          return {
            kind: "permanent",
            code: "SMTP_STARTTLS_UNAVAILABLE",
            detail: "Server did not advertise STARTTLS",
          };
        }
        failure = requireCode(await channel.command("STARTTLS", signal), [220]);
        if (failure) return failure;
        channel.detach();
        const upgraded = connectTls({
          socket,
          ...(isIP(settings.host) === 0 ? { servername: settings.host } : {}),
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
          ...(settings.ca === undefined ? {} : { ca: settings.ca }),
        });
        socket = upgraded;
        await ready(upgraded, "secureConnect", signal);
        channel = new SmtpChannel(upgraded);
        ehlo = await channel.command(`EHLO ${settings.ehloName}`, signal);
        failure = requireCode(ehlo, [250]);
        if (failure) return failure;
      }
      const auth = ehlo.lines.find((line) => line.toUpperCase().startsWith("AUTH "));
      if (!auth?.toUpperCase().split(/\s+/).includes("PLAIN")) {
        return {
          kind: "permanent",
          code: "SMTP_AUTH_UNAVAILABLE",
          detail: "Server did not advertise AUTH PLAIN over TLS",
        };
      }
      const credentials = Buffer.from(`\0${settings.username}\0${settings.password}`).toString(
        "base64",
      );
      failure = requireCode(await channel.command(`AUTH PLAIN ${credentials}`, signal), [235]);
      if (failure || message === null)
        return failure ?? { kind: "accepted", receipt: "SMTP authentication accepted" };
      failure = requireCode(await channel.command(`MAIL FROM:<${settings.from}>`, signal), [250]);
      if (failure) return failure;
      failure = requireCode(
        await channel.command(`RCPT TO:<${message.recipient}>`, signal),
        [250, 251],
      );
      if (failure) return failure;
      failure = requireCode(await channel.command("DATA", signal), [354]);
      if (failure) return failure;
      const content = smtpContent(message, {
        from: settings.from,
        ehloName: settings.ehloName,
        at,
      });
      await channel.write(`${dotStuff(content)}.\r\n`, signal);
      const accepted = await channel.reply(signal);
      failure = requireCode(accepted, [250]);
      if (failure) return failure;
      return {
        kind: "accepted",
        receipt: `${accepted.code} ${accepted.lines.join(" ")}`.slice(0, 240),
      };
    } catch (error) {
      if (error instanceof SmtpTransportError || error instanceof Error) {
        return {
          kind: "temporary",
          code: "SMTP_TRANSPORT_FAILED",
          detail: "SMTP TLS or transport failed",
        };
      }
      throw error;
    } finally {
      socket?.destroy();
    }
  }
}

export type { SmtpAttempt } from "./smtp-channel";
