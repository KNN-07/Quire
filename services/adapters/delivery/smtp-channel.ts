import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import { z } from "zod";

export type SmtpSocket = Socket | TLSSocket;
export type SmtpReply = { readonly code: number; readonly lines: readonly string[] };
export type SmtpAttempt =
  | { readonly kind: "accepted"; readonly receipt: string }
  | { readonly kind: "temporary" | "permanent"; readonly code: string; readonly detail: string };

export class SmtpTransportError extends Error {
  readonly name = "SmtpTransportError";
}

export class SmtpChannel {
  private buffer = "";
  private readonly lines: string[] = [];
  private readonly waiters: Array<{
    readonly resolve: (line: string) => void;
    readonly reject: (error: Error) => void;
  }> = [];

  private readonly onData = (chunk: Buffer): void => {
    this.buffer += chunk.toString("utf8");
    if (this.buffer.length > 64 * 1024) {
      this.fail(new SmtpTransportError("SMTP response exceeds buffer limit"));
      return;
    }
    for (;;) {
      const end = this.buffer.indexOf("\r\n");
      if (end < 0) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(line);
      else this.lines.push(line);
    }
  };

  private readonly onError = (): void => this.fail(new SmtpTransportError("SMTP transport failed"));
  private readonly onClose = (): void => this.fail(new SmtpTransportError("SMTP transport closed"));

  constructor(readonly socket: SmtpSocket) {
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }

  async reply(signal: AbortSignal): Promise<SmtpReply> {
    const first = z
      .string()
      .regex(/^\d{3}[- ].*$/)
      .parse(await this.next(signal));
    const code = Number(first.slice(0, 3));
    const lines = [first.slice(4)];
    if (first[3] === " ") return { code, lines };
    for (;;) {
      const line = z
        .string()
        .regex(/^\d{3}[- ].*$/)
        .parse(await this.next(signal));
      if (Number(line.slice(0, 3)) !== code) {
        throw new SmtpTransportError("SMTP multiline reply code changed");
      }
      lines.push(line.slice(4));
      if (line[3] === " ") return { code, lines };
    }
  }

  async command(value: string, signal: AbortSignal): Promise<SmtpReply> {
    await this.write(`${value}\r\n`, signal);
    return this.reply(signal);
  }

  async write(value: string, signal: AbortSignal): Promise<void> {
    if (this.socket.write(value)) return;
    await new Promise<void>((resolve, reject) => {
      const finish = (complete: () => void): void => {
        signal.removeEventListener("abort", abort);
        this.socket.off("error", error);
        this.socket.off("drain", drain);
        complete();
      };
      const abort = (): void =>
        finish(() => reject(new SmtpTransportError("SMTP write timed out")));
      const error = (): void => finish(() => reject(new SmtpTransportError("SMTP write failed")));
      const drain = (): void => finish(resolve);
      signal.addEventListener("abort", abort, { once: true });
      this.socket.once("error", error);
      this.socket.once("drain", drain);
    });
  }

  detach(): void {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
  }

  private next(signal: AbortSignal): Promise<string> {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (value: string): void => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        reject: (error: Error): void => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      };
      const abort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new SmtpTransportError("SMTP operation timed out"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private fail(error: Error): void {
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
}

export function ready(
  socket: SmtpSocket,
  event: "connect" | "secureConnect",
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (): void => finish(() => reject(new SmtpTransportError("SMTP connection failed")));
    const abort = (): void => {
      socket.destroy();
      finish(() => reject(new SmtpTransportError("SMTP connection timed out")));
    };
    const success = (): void => finish(resolve);
    const finish = (complete: () => void): void => {
      socket.off(event, success);
      socket.off("error", fail);
      signal.removeEventListener("abort", abort);
      complete();
    };
    socket.once(event, success);
    socket.once("error", fail);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function requireCode(response: SmtpReply, accepted: readonly number[]): SmtpAttempt | null {
  if (accepted.includes(response.code)) return null;
  const detail = response.lines
    .join(" ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 240);
  return response.code >= 400 && response.code < 500
    ? { kind: "temporary", code: `SMTP_${response.code}`, detail }
    : { kind: "permanent", code: `SMTP_${response.code}`, detail };
}
