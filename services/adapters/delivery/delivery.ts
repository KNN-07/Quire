import { z } from "zod";
import { InstantSchema } from "@quire/contracts";
import type { Instant, Transaction } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { smtpAvailability } from "./configuration";
import { SmtpClient } from "./smtp";
import type { SmtpAttempt } from "./smtp";

const OutboxRowSchema = z
  .object({
    id: z.uuid(),
    recipient: z.email(),
    subject: z.string(),
    body: z.string(),
    attempts: z.number().int().nonnegative(),
    lease_id: z.uuid(),
  })
  .readonly();

type ClaimedMail = z.infer<typeof OutboxRowSchema>;
export type DeliverySummary = {
  readonly state: "ready" | "unconfigured" | "disabled";
  readonly reason?: string;
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly permanent: number;
};

export type MailDeliveryOptions = {
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly maxAttempts?: number;
  readonly retryMs?: readonly number[];
  readonly smtp?: SmtpClient;
};

function nextAttempt(now: Instant, attempts: number, retryMs: readonly number[]): Instant {
  const index = Math.min(Math.max(attempts - 1, 0), retryMs.length - 1);
  return InstantSchema.parse(new Date(Date.parse(now) + (retryMs[index] ?? 60_000)).toISOString());
}

export class MailDelivery {
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly retryMs: readonly number[];
  private readonly smtp: SmtpClient;
  private readonly running = new Set<Promise<DeliverySummary>>();
  private closed = false;

  constructor(
    private readonly context: ModuleContext,
    options: MailDeliveryOptions = {},
  ) {
    this.batchSize = z
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(options.batchSize ?? 20);
    this.leaseMs = z
      .number()
      .int()
      .min(1_000)
      .max(10 * 60_000)
      .parse(options.leaseMs ?? 60_000);
    this.maxAttempts = z
      .number()
      .int()
      .min(1)
      .max(20)
      .parse(options.maxAttempts ?? 5);
    this.retryMs = z
      .array(z.number().int().positive())
      .min(1)
      .readonly()
      .parse(options.retryMs ?? [60_000, 300_000, 1_800_000, 7_200_000]);
    this.smtp = options.smtp ?? new SmtpClient();
  }

  drain(): Promise<DeliverySummary> {
    if (this.closed)
      return Promise.resolve({
        state: "disabled",
        reason: "Delivery scheduler closed",
        claimed: 0,
        sent: 0,
        retried: 0,
        permanent: 0,
      });
    const execution = this.run();
    this.running.add(execution);
    void execution.then(() => this.running.delete(execution), () => this.running.delete(execution));
    return execution;
  }

  private async run(): Promise<DeliverySummary> {
    const availability = await smtpAvailability(this.context);
    if (availability.state !== "ready") {
      return {
        state: availability.state,
        reason: availability.reason,
        claimed: 0,
        sent: 0,
        retried: 0,
        permanent: 0,
      };
    }
    const claimed = await this.claim();
    let sent = 0;
    let retried = 0;
    let permanent = 0;
    for (const mail of claimed) {
      const outcome = await this.smtp.send(availability.settings, mail, this.context.clock.now());
      const state = await this.finish(mail, outcome);
      if (state === "sent") sent++;
      else if (state === "retry") retried++;
      else permanent++;
    }
    return { state: "ready", claimed: claimed.length, sent, retried, permanent };
  }

  private async claim(): Promise<readonly ClaimedMail[]> {
    return this.context.uow.run(async (tx) => {
      await tx.lock("adapter:mail-delivery");
      const now = this.context.clock.now();
      await tx.run(
        `INSERT INTO adapter_mail_deliveries(outbox_id,provider,state,attempts,next_attempt_at,updated_at)
        SELECT id,'smtp','pending',0,created_at,? FROM mail_outbox
        WHERE sent_at IS NULL AND status IN ('local','pending')
        ON CONFLICT(outbox_id) DO NOTHING`,
        [now],
      );
      const candidates = await tx.all<{ id: string }>(
        `SELECT d.outbox_id AS id
        FROM adapter_mail_deliveries d JOIN mail_outbox m ON m.id=d.outbox_id
        WHERE d.provider='smtp' AND d.state IN ('pending','retry','sending')
          AND d.next_attempt_at<=? AND (d.state<>'sending' OR d.lease_expires_at<=?)
          AND m.sent_at IS NULL
        ORDER BY d.next_attempt_at,d.outbox_id LIMIT ?`,
        [now, now, this.batchSize],
      );
      const claimed: ClaimedMail[] = [];
      for (const candidate of candidates) {
        const lease = crypto.randomUUID();
        const expires = new Date(Date.parse(now) + this.leaseMs).toISOString();
        const result = await tx.run(
          `UPDATE adapter_mail_deliveries
          SET state='sending',attempts=attempts+1,lease_id=?,lease_expires_at=?,updated_at=?
          WHERE outbox_id=? AND state IN ('pending','retry','sending')
            AND next_attempt_at<=? AND (state<>'sending' OR lease_expires_at<=?)`,
          [lease, expires, now, candidate.id, now, now],
        );
        if (result.changes === 0) continue;
        claimed.push(
          OutboxRowSchema.parse(
            await tx.get(
              `SELECT m.id,m.recipient,m.subject,m.body,d.attempts,d.lease_id
          FROM mail_outbox m JOIN adapter_mail_deliveries d ON d.outbox_id=m.id WHERE m.id=?`,
              [candidate.id],
            ),
          ),
        );
      }
      return claimed;
    });
  }

  private async finish(
    mail: ClaimedMail,
    outcome: SmtpAttempt,
  ): Promise<"sent" | "retry" | "permanent"> {
    return this.context.uow.run(async (tx) => {
      await tx.lock("adapter:mail-delivery");
      const current = await tx.get<{ lease_id: string | null; state: string }>(
        "SELECT lease_id,state FROM adapter_mail_deliveries WHERE outbox_id=?",
        [mail.id],
      );
      if (current?.lease_id !== mail.lease_id || current.state !== "sending") return "permanent";
      const now = this.context.clock.now();
      if (outcome.kind === "accepted") {
        await tx.run(
          `UPDATE adapter_mail_deliveries
          SET state='sent',provider_receipt=?,last_code=NULL,last_detail=NULL,delivered_at=?,
            lease_id=NULL,lease_expires_at=NULL,updated_at=?
          WHERE outbox_id=? AND lease_id=?`,
          [outcome.receipt, now, now, mail.id, mail.lease_id],
        );
        await tx.run("UPDATE mail_outbox SET sent_at=COALESCE(sent_at,?) WHERE id=?", [
          now,
          mail.id,
        ]);
        return "sent";
      }
      const exhausted = outcome.kind === "temporary" && mail.attempts >= this.maxAttempts;
      const state = outcome.kind === "permanent" || exhausted ? "permanent" : "retry";
      await this.recordFailure(tx, mail, outcome, state, now);
      return state;
    });
  }

  private async recordFailure(
    tx: Transaction,
    mail: ClaimedMail,
    outcome: Exclude<SmtpAttempt, { readonly kind: "accepted" }>,
    state: "retry" | "permanent",
    now: Instant,
  ): Promise<void> {
    const code =
      state === "permanent" && outcome.kind === "temporary" ? "SMTP_RETRY_EXHAUSTED" : outcome.code;
    await tx.run(
      `UPDATE adapter_mail_deliveries
      SET state=?,next_attempt_at=?,last_code=?,last_detail=?,provider_receipt=NULL,
        lease_id=NULL,lease_expires_at=NULL,updated_at=?
      WHERE outbox_id=? AND lease_id=? AND provider='smtp'`,
      [
        state,
        state === "retry" ? nextAttempt(now, mail.attempts, this.retryMs) : now,
        code,
        outcome.detail,
        now,
        mail.id,
        mail.lease_id,
      ],
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.running);
  }
}
