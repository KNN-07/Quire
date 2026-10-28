import { expect, test } from "bun:test";
import { SecretBox } from "../../../services/adapters/shared/secrets";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { SmtpFixture } from "../../adapters/delivery/smtp-fixture";
import { fixtureCertificate } from "../../adapters/delivery/tls-material";
import { bounded } from "../portable/process";
import { integrationFixture } from "./harness";

test("drains a scheduled real TLS SMTP delivery before closing subscriptions and storage", async () => {
  // Given
  const listeners = new Set<() => void>();
  const schedulerTicks = { subscribe(listener: () => void) {
    listeners.add(listener); return () => { listeners.delete(listener); };
  } };
  await using transport = { smtp: new SmtpFixture(),
    async [Symbol.asyncDispose]() { await this.smtp.close(); } };
  const smtp = transport.smtp;
  await smtp.start();
  await using fixture = await integrationFixture({ schedulerTicks });
  const id = crypto.randomUUID();
  const encrypted = new SecretBox(fixture.runtime.secretKey).seal(JSON.stringify({
    username: "fixture-user", password: "fixture-password", from: "no-reply@quire.local",
    ehloName: "quire.local", ca: fixtureCertificate,
  }), "provider:smtp");
  await fixture.runtime.uow.run(async tx => {
    await tx.run(`INSERT INTO adapter_provider_configs(id,kind,base_url,model,encrypted_secret,policy_json,enabled,version,updated_at)
      VALUES(?,'smtp',?,'implicit',?,?,1,1,?)`,
    [crypto.randomUUID(), `https://127.0.0.1:${smtp.port}`, encrypted, JSON.stringify(defaultPolicy), fixture.clock.now()]);
    await tx.run(`INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,status,created_at)
      VALUES(?,'reader@example.test','Scheduler integration','Retained body',?,'local',?)`,
    [id, id, fixture.clock.now()]);
  });
  await fixture.start();
  const accepted = smtp.nextMessage();
  // When
  for (const tick of listeners) tick();
  await fixture.adapters.close();
  // Then
  expect((await accepted).messageId).toContain(id);
  expect(listeners.size).toBe(0);
  expect(await fixture.runtime.db.get<{ state: string }>("SELECT state FROM adapter_mail_deliveries WHERE outbox_id=?", [id])).toEqual({ state: "sent" });
  expect(await fixture.runtime.db.get<{ status: string }>("SELECT status FROM mail_outbox WHERE id=?", [id])).toEqual({ status: "local" });
}, 90_000);

test("stops a failing admitted task subscription and still closes sibling factories and storage", async () => {
  // Given
  const listeners = new Set<() => void>();
  const stopped = Promise.withResolvers<void>();
  const schedulerTicks = { subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); stopped.resolve(); };
  } };
  const execute = async () => {
    await using fixture = await integrationFixture({ schedulerTicks });
    const id = crypto.randomUUID();
    const encrypted = new SecretBox(fixture.runtime.secretKey).seal(JSON.stringify({
      username: "fixture-user", password: "fixture-password", from: "no-reply@quire.local",
      ehloName: "quire.local", ca: fixtureCertificate,
    }), "provider:smtp");
    await fixture.runtime.uow.run(async tx => {
      await tx.run(`INSERT INTO adapter_provider_configs(id,kind,base_url,model,encrypted_secret,policy_json,enabled,version,updated_at)
        VALUES(?,'smtp','https://127.0.0.1:1','implicit',?,?,1,1,?)`,
      [crypto.randomUUID(), encrypted, JSON.stringify(defaultPolicy), fixture.clock.now()]);
      await tx.run(`INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,status,created_at)
        VALUES(?,'reader@example.test','Failed schedule','Retained',?,'local',?)`, [id, id, fixture.clock.now()]);
      await tx.exec(`CREATE TRIGGER integration_delivery_failure BEFORE INSERT ON adapter_mail_deliveries
        BEGIN SELECT RAISE(ABORT,'integration delivery persistence failure'); END`);
    });
    await fixture.start();
    // When
    for (const tick of listeners) tick();
    await bounded(stopped.promise, 10_000);
    // Then: the failing task stopped before shutdown, without stopping its siblings.
    expect(listeners.size).toBe(2);
    // The resource scope now closes all sibling factories and runtime despite the retained failure.
  };
  const failure = await execute().then(() => null, error => {
    if (!(error instanceof AggregateError)) throw error;
    return error;
  });
  expect(failure).toBeInstanceOf(AggregateError);
  expect(listeners.size).toBe(0);
}, 90_000);
