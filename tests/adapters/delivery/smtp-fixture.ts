import { createServer, type TLSSocket } from "node:tls";
import { z } from "zod";
import { fixtureCertificate, fixtureKey } from "./tls-material";

export type FixtureMode = "accept" | "temporary" | "permanent";
export type ReceivedMail = {
  readonly messageId: string;
  readonly recipient: string;
  readonly content: string;
};

type Session = {
  readonly socket: TLSSocket;
  buffer: string;
  data: string[];
  recipient: string;
  authenticated: boolean;
  receiving: boolean;
};

export class SmtpFixture {
  private readonly server = createServer(
    { key: fixtureKey, cert: fixtureCertificate, minVersion: "TLSv1.2" },
    (socket) => this.accept(socket),
  );
  private readonly sockets = new Set<TLSSocket>();
  private readonly messages: ReceivedMail[] = [];
  private readonly messageIds = new Set<string>();
  private readonly waiters: Array<(message: ReceivedMail) => void> = [];
  private readonly commandLog: string[] = [];
  private mode: FixtureMode = "accept";
  private portValue = 0;

  get port(): number {
    return this.portValue;
  }

  get received(): readonly ReceivedMail[] {
    return this.messages;
  }

  get commands(): readonly string[] {
    return this.commandLog;
  }

  setMode(mode: FixtureMode): void {
    this.mode = mode;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new TypeError("SMTP fixture did not bind TCP");
    this.portValue = address.port;
  }

  nextMessage(): Promise<ReceivedMail> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiters.indexOf(resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new TypeError("SMTP fixture message timeout"));
      }, 5_000);
      this.waiters.push((message) => {
        clearTimeout(timeout);
        resolve(message);
      });
    });
  }

  private accept(socket: TLSSocket): void {
    this.sockets.add(socket);
    const session: Session = {
      socket,
      buffer: "",
      data: [],
      recipient: "",
      authenticated: false,
      receiving: false,
    };
    this.attach(session);
    socket.write("220 fixture.local ESMTP ready\r\n");
  }

  private attach(session: Session): void {
    const socket = session.socket;
    const onData = (chunk: Buffer): void => {
      session.buffer += chunk.toString("utf8");
      for (;;) {
        const end = session.buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = session.buffer.slice(0, end);
        session.buffer = session.buffer.slice(end + 2);
        this.line(session, line);
      }
    };
    socket.on("data", onData);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => {});
  }

  private line(session: Session, line: string): void {
    if (session.receiving) {
      if (line === ".") {
        session.receiving = false;
        this.acceptMessage(session);
      } else {
        session.data.push(line.startsWith("..") ? line.slice(1) : line);
      }
      return;
    }
    this.commandLog.push(
      line.toUpperCase().startsWith("AUTH PLAIN ") ? "AUTH PLAIN [redacted]" : line,
    );
    const [verb = ""] = line.split(" ", 1);
    switch (verb.toUpperCase()) {
      case "EHLO":
        session.socket.write("250-fixture.local\r\n250 AUTH PLAIN\r\n");
        return;
      case "STARTTLS":
        session.socket.write("503 5.5.1 TLS already active\r\n");
        return;
      case "AUTH": {
        const encoded = line.split(" ")[2] ?? "";
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        session.authenticated = decoded === "\0fixture-user\0fixture-password";
        session.socket.write(
          session.authenticated
            ? "235 2.7.0 authenticated\r\n"
            : "535 5.7.8 invalid credentials\r\n",
        );
        return;
      }
      case "MAIL":
        session.socket.write(
          session.authenticated
            ? "250 2.1.0 sender accepted\r\n"
            : "530 5.7.0 authentication required\r\n",
        );
        return;
      case "RCPT":
        session.recipient = z
          .string()
          .regex(/^RCPT TO:<(.+)>$/i)
          .parse(line)
          .replace(/^RCPT TO:<|>$/gi, "");
        session.socket.write(
          this.mode === "temporary"
            ? "450 4.2.0 mailbox temporarily unavailable\r\n"
            : this.mode === "permanent"
              ? "550 5.1.1 mailbox rejected\r\n"
              : "250 2.1.5 recipient accepted\r\n",
        );
        return;
      case "DATA":
        session.data = [];
        session.receiving = true;
        session.socket.write("354 End data with <CRLF>.<CRLF>\r\n");
        return;
      case "QUIT":
        session.socket.end("221 2.0.0 bye\r\n");
        return;
      default:
        session.socket.write("500 5.5.2 unsupported command\r\n");
    }
  }

  private acceptMessage(session: Session): void {
    const content = `${session.data.join("\r\n")}\r\n`;
    const messageId = z
      .string()
      .min(1)
      .parse(content.match(/^Message-ID:\s*<([^>]+)>$/im)?.[1]);
    const message = { messageId, recipient: session.recipient, content };
    if (!this.messageIds.has(messageId)) {
      this.messageIds.add(messageId);
      this.messages.push(message);
      this.waiters.shift()?.(message);
    }
    session.socket.write(`250 2.0.0 queued as ${messageId}\r\n`);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
