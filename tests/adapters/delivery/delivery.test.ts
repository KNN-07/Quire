import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { fixtureCertificate } from "./tls-material";
import { SmtpFixture } from "./smtp-fixture";
import { configure, createHarness, dispose, queue, restart } from "./harness";
import type { Harness } from "./harness";

describe("configured SMTP outbox delivery", () => {
  let fixture: SmtpFixture;
  const harnesses: Harness[] = [];

  beforeEach(async () => {
    fixture = new SmtpFixture();
    await fixture.start();
  });

  afterEach(async () => {
    for (const harness of harnesses.splice(0)) await dispose(harness);
    await fixture.close();
  });

  test("reports exact missing configuration and preserves the local mailbox", async () => {
    // Given: a durable local outbox item and no SMTP provider configuration.
    const harness = await createHarness();
    harnesses.push(harness);
    const id = await queue(harness);

    // When: delivery is drained.
    const result = await harness.delivery.drain();

    // Then: configuration is truthful, no delivery row is invented, and local mail remains readable.
    expect(result).toEqual({
      state: "unconfigured",
      reason:
        "Missing: operator SMTP provider configuration; SMTP host URL; TLS mode model (starttls or implicit); encrypted SMTP username/password/from identity",
      claimed: 0,
      sent: 0,
      retried: 0,
      permanent: 0,
    });
    expect(
      await harness.runtime.db.get(
        "SELECT outbox_id FROM adapter_mail_deliveries WHERE outbox_id=?",
        [id],
      ),
    ).toBeNull();
    expect(
      await harness.runtime.db.get<{ status: string; sent_at: string | null }>(
        "SELECT status,sent_at FROM mail_outbox WHERE id=?",
        [id],
      ),
    ).toEqual({ status: "local", sent_at: null });
  });

  test("scheduler closes delivery and reports an actual SQL failure without an orphan rejection", async () => {
    // Given: real configured delivery whose claim transaction is rejected by SQLite.
    const harness = await createHarness();
    harnesses.push(harness);
    await configure(harness, fixture);
    await queue(harness);
    await harness.runtime.db.exec(`CREATE TRIGGER reject_delivery BEFORE INSERT ON adapter_mail_deliveries
      BEGIN SELECT RAISE(ABORT,'delivery-claim-failure'); END`);
    // When: a scheduled drain fails while shutdown waits for the actual work.
    const scheduler = harness.delivery.schedule(60000);
    const error = await scheduler.close().then(() => null, (failure: unknown) => failure);
    // Then: failure reaches the owner and shutdown closes the delivery object.
    expect(error).toBeInstanceOf(Error);
    expect((await harness.delivery.drain()).state).toBe("disabled");
    expect(fixture.received).toHaveLength(0);
  });

  test("reports configured-disabled state without opening an SMTP transaction", async () => {
    // Given: valid protected SMTP settings disabled by the operator.
    const harness = await createHarness();
    harnesses.push(harness);
    await configure(harness, fixture, { enabled: false });
    await queue(harness);

    // When: delivery is drained.
    const result = await harness.delivery.drain();

    // Then: the disabled state is explicit and the fixture receives no message.
    expect(result).toEqual({
      state: "disabled",
      reason: "SMTP provider disabled by operator",
      claimed: 0,
      sent: 0,
      retried: 0,
      permanent: 0,
    });
    expect(fixture.received).toHaveLength(0);
  });

  test("delivers over authenticated TLS once across restart", async () => {
    // Given: configured SMTP and one pre-existing local outbox item.
    const harness = await createHarness();
    harnesses.push(harness);
    await configure(harness, fixture);
    const id = await queue(harness);
    const received = fixture.nextMessage();

    // When: the worker drains, restarts, and drains the same persistent outbox again.
    const first = await harness.delivery.drain();
    const message = await received;
    await restart(harness);
    const second = await harness.delivery.drain();

    // Then: TLS delivery, stable identity, receipt persistence, local retention, and restart dedupe hold.
    expect(first).toEqual({ state: "ready", claimed: 1, sent: 1, retried: 0, permanent: 0 });
    expect(second).toEqual({ state: "ready", claimed: 0, sent: 0, retried: 0, permanent: 0 });
    expect(message.messageId).toBe(`${id}@quire.local`);
    expect(message.recipient).toBe("reader@example.test");
    expect(
      Buffer.from(
        message.content.split("\r\n\r\n")[1]?.replace(/\r\n/g, "") ?? "",
        "base64",
      ).toString(),
    ).toBe("Durable body with unicode: Việt");
    expect(fixture.received).toHaveLength(1);
    expect(
      await harness.runtime.db.get<{
        state: string;
        attempts: number;
        last_code: string | null;
        delivered_at: string | null;
      }>(
        "SELECT state,attempts,last_code,delivered_at FROM adapter_mail_deliveries WHERE outbox_id=?",
        [id],
      ),
    ).toEqual({ state: "sent", attempts: 1, last_code: null, delivered_at: harness.clock.now() });
    expect(
      await harness.runtime.db.get<{ status: string; sent_at: string | null }>(
        "SELECT status,sent_at FROM mail_outbox WHERE id=?",
        [id],
      ),
    ).toEqual({ status: "local", sent_at: harness.clock.now() });
  });

  test("retries temporary rejection and records permanent rejection without leaking content", async () => {
    // Given: one temporarily rejected message and one permanently rejected message.
    const harness = await createHarness({ retryMs: [60_000] });
    harnesses.push(harness);
    await configure(harness, fixture);
    fixture.setMode("temporary");
    const retryId = await queue(harness, "temporary@example.test");

    // When: the temporary response is retried after its persisted due time.
    const temporary = await harness.delivery.drain();
    harness.clock.advance(60_000);
    fixture.setMode("accept");
    const received = fixture.nextMessage();
    const accepted = await harness.delivery.drain();
    await received;
    fixture.setMode("permanent");
    const permanentId = await queue(harness, "permanent@example.test");
    const permanent = await harness.delivery.drain();

    // Then: 4xx is retried, 5xx is terminal, and persisted diagnostics contain no message body or credential.
    expect(temporary).toEqual({ state: "ready", claimed: 1, sent: 0, retried: 1, permanent: 0 });
    expect(accepted).toEqual({ state: "ready", claimed: 1, sent: 1, retried: 0, permanent: 0 });
    expect(permanent).toEqual({ state: "ready", claimed: 1, sent: 0, retried: 0, permanent: 1 });
    expect(
      await harness.runtime.db.get<{
        state: string;
        attempts: number;
        last_code: string | null;
        last_detail: string | null;
      }>(
        "SELECT state,attempts,last_code,last_detail FROM adapter_mail_deliveries WHERE outbox_id=?",
        [retryId],
      ),
    ).toEqual({ state: "sent", attempts: 2, last_code: null, last_detail: null });
    const rejected = z
      .object({
        state: z.literal("permanent"),
        attempts: z.literal(1),
        last_code: z.literal("SMTP_550"),
        last_detail: z.string(),
      })
      .parse(
        await harness.runtime.db.get(
          "SELECT state,attempts,last_code,last_detail FROM adapter_mail_deliveries WHERE outbox_id=?",
          [permanentId],
        ),
      );
    expect(rejected.last_detail).not.toContain("Durable body");
    expect(rejected.last_detail).not.toContain("fixture-password");
  });

  test("classifies TLS verification failure for retry and closes the scheduler cleanly", async () => {
    // Given: an untrusted SMTP certificate followed by a valid configuration and queued mail.
    const harness = await createHarness({ retryMs: [60_000] });
    harnesses.push(harness);
    await configure(harness, fixture, { ca: fixtureCertificate.replace("MIID", "NIID") });
    const id = await queue(harness);

    // When: TLS verification fails, then a separately configured scheduler delivers a later item.
    const failure = await harness.delivery.drain();
    await harness.runtime.db.run("DELETE FROM adapter_provider_configs WHERE kind='smtp'");
    await configure(harness, fixture);
    harness.clock.advance(60_000);
    const received = fixture.nextMessage();
    const scheduler = harness.delivery.schedule(60_000);
    await received;
    await scheduler.close();

    // Then: failure was retryable, scheduler completion persisted, and close drained owned work.
    expect(failure).toEqual({ state: "ready", claimed: 1, sent: 0, retried: 1, permanent: 0 });
    expect(
      await harness.runtime.db.get<{
        state: string;
        attempts: number;
        last_code: string | null;
        lease_id: string | null;
      }>(
        "SELECT state,attempts,last_code,lease_id FROM adapter_mail_deliveries WHERE outbox_id=?",
        [id],
      ),
    ).toEqual({ state: "sent", attempts: 2, last_code: null, lease_id: null });
  });
});
