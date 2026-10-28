import { z } from "zod";
import type { Instant } from "@quire/contracts";

const HeaderTextSchema = z
  .string()
  .min(1)
  .max(998)
  .refine((value) => !/[\r\n]/.test(value));
const BodySchema = z.string().max(2 * 1024 * 1024);

export type OutboxMessage = {
  readonly id: string;
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
};

function wrapBase64(value: string): string {
  return (
    Buffer.from(value, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? ""
  );
}

function encodedHeader(value: string): string {
  const parsed = HeaderTextSchema.parse(value);
  return /^[\x20-\x7e]*$/.test(parsed)
    ? parsed
    : `=?UTF-8?B?${Buffer.from(parsed).toString("base64")}?=`;
}

export function smtpContent(
  message: OutboxMessage,
  input: { readonly from: string; readonly ehloName: string; readonly at: Instant },
): string {
  const recipient = z.email().parse(message.recipient);
  const body = BodySchema.parse(message.body);
  const headers = [
    `From: <${z.email().parse(input.from)}>`,
    `To: <${recipient}>`,
    `Subject: ${encodedHeader(message.subject)}`,
    `Date: ${new Date(input.at).toUTCString()}`,
    `Message-ID: <${z.uuid().parse(message.id)}@${input.ehloName}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${wrapBase64(body)}\r\n`;
}

export function dotStuff(content: string): string {
  return content
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}
