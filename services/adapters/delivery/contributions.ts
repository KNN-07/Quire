import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import { defineAction } from "../shared";
import type { AdapterContribution, ProviderSettings } from "../shared";
import { parseSmtpSettings } from "./configuration";
import { SmtpClient } from "./smtp";

const SendSchema = z.strictObject({ outboxId: z.uuid() }).readonly();
const MailSchema = z
  .object({
    id: z.uuid(),
    recipient: z.email(),
    subject: z.string(),
    body: z.string(),
    status: z.string(),
  })
  .readonly();

function requirements(settings: ProviderSettings): readonly string[] {
  const availability = parseSmtpSettings(settings);
  return availability.state === "unconfigured"
    ? availability.reason.replace(/^Missing: /, "").split("; ")
    : [];
}

export const smtpContribution: AdapterContribution = (services) => {
  const client = new SmtpClient();
  return {
    kind: "smtp",
    label: "SMTP delivery",
    configuration: requirements,
    actions: {
      send: defineAction(SendSchema, {
        projectAccess: "none",
        async prepare(parameters, context) {
          const availability = parseSmtpSettings(context.configuration);
          if (availability.state !== "ready") {
            throw new ServiceError("PROVIDER_UNCONFIGURED", 503, availability.reason);
          }
          const message = MailSchema.parse(
            await services.context.db.get(
              "SELECT id,recipient,subject,body,status FROM mail_outbox WHERE id=? AND sent_at IS NULL",
              [parameters.outboxId],
            ),
          );
          const result = await client.send(
            availability.settings,
            message,
            services.context.clock.now(),
          );
          if (result.kind !== "accepted") {
            throw new ServiceError(
              result.code,
              result.kind === "temporary" ? 503 : 422,
              result.detail,
            );
          }
          return {
            result: { outboxId: message.id, provider: "smtp", receipt: result.receipt },
            cursor: null,
            async publish(tx) {
              const now = services.context.clock.now();
              await tx.run(
                `INSERT INTO adapter_mail_deliveries(
                outbox_id,provider,state,attempts,next_attempt_at,provider_receipt,delivered_at,updated_at
              ) VALUES(?,'smtp','sent',1,?,?,?,?)
              ON CONFLICT(outbox_id) DO UPDATE SET
                state='sent',attempts=adapter_mail_deliveries.attempts+1,
                provider_receipt=excluded.provider_receipt,last_code=NULL,last_detail=NULL,
                delivered_at=excluded.delivered_at,lease_id=NULL,lease_expires_at=NULL,updated_at=excluded.updated_at`,
                [message.id, now, result.receipt, now, now],
              );
              await tx.run("UPDATE mail_outbox SET sent_at=COALESCE(sent_at,?) WHERE id=?", [
                now,
                message.id,
              ]);
            },
          };
        },
      }),
    },
    async probe(settings) {
      const availability = parseSmtpSettings(settings);
      if (availability.state !== "ready") return { ok: false, reason: availability.reason };
      const result = await client.probe(availability.settings);
      return result.kind === "accepted" ? { ok: true } : { ok: false, reason: result.detail };
    },
    async test(context) {
      const availability = parseSmtpSettings(context.configuration);
      if (availability.state !== "ready") return { ok: false, reason: availability.reason };
      const result = await client.probe(availability.settings);
      return result.kind === "accepted" ? { ok: true } : { ok: false, reason: result.detail };
    },
  };
};

export const localMailContribution: AdapterContribution = (services) => ({
  kind: "localMail",
  label: "Local durable mailbox",
  configuration: () => [],
  actions: {
    send: defineAction(SendSchema, {
      projectAccess: "none",
      async prepare(parameters) {
        const message = MailSchema.parse(
          await services.context.db.get(
            "SELECT id,recipient,subject,body,status FROM mail_outbox WHERE id=?",
            [parameters.outboxId],
          ),
        );
        if (message.status !== "local") {
          throw new ServiceError(
            "LOCAL_MAIL_UNAVAILABLE",
            409,
            "Outbox item is not retained in the local mailbox",
          );
        }
        return {
          result: { outboxId: message.id, provider: "localMail", receipt: "retained" },
          cursor: null,
        };
      },
    }),
  },
  test: async () => ({ ok: true }),
  probe: async () => ({ ok: true }),
});
