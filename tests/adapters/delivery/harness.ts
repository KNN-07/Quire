import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig } from "@quire/runtime";
import type { Runtime } from "@quire/runtime";
import { InstantSchema } from "@quire/contracts";
import {
  register as identity,
  migrations as identityMigrations,
} from "../../../services/accounts/identity";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { createAdapterModules } from "../../../services/adapters/shared";
import { SecretBox } from "../../../services/adapters/shared/secrets";
import {
  createDeliveryModule,
  localMailContribution,
  smtpContribution,
} from "../../../services/adapters/delivery";
import { fixtureCertificate } from "./tls-material";
import type { SmtpFixture } from "./smtp-fixture";

type Clock = ReturnType<typeof controlledClock>;
export type Harness = {
  readonly path: string;
  readonly clock: Clock;
  adapters: ReturnType<typeof createAdapterModules>;
  delivery: ReturnType<typeof createDeliveryModule>;
  runtime: Runtime;
};

function controlledClock() {
  let now = Date.parse("2026-10-27T12:00:00.000Z");
  return {
    now: () => InstantSchema.parse(new Date(now).toISOString()),
    advance(milliseconds: number): void {
      now += milliseconds;
    },
  };
}

function modules(
  adapters: ReturnType<typeof createAdapterModules>,
  delivery: ReturnType<typeof createDeliveryModule>,
) {
  return [
    {
      id: "010-a-identity",
      lane: "A",
      order: 10,
      register: identity,
      migrations: identityMigrations,
    },
    adapters.connections,
    adapters.providers,
    delivery.module,
  ] as const;
}

export async function createHarness(
  options: Parameters<typeof createDeliveryModule>[0] = {},
): Promise<Harness> {
  const path = await mkdtemp(join(tmpdir(), "quire-p2x-delivery-"));
  const clock = controlledClock();
  const adapters = createAdapterModules({
    contributions: [smtpContribution, localMailContribution],
  });
  const delivery = createDeliveryModule(options);
  const config = loadConfig({ QUIRE_DATA_DIR: path, QUIRE_PUBLIC_URL: "http://localhost:5173" });
  const runtime = await createRuntime(config, { clock, modules: modules(adapters, delivery) });
  return { path, clock, adapters, delivery, runtime };
}

export async function configure(
  harness: Harness,
  fixture: SmtpFixture,
  input: { readonly enabled?: boolean; readonly ca?: string } = {},
): Promise<void> {
  const secret = JSON.stringify({
    username: "fixture-user",
    password: "fixture-password",
    from: "no-reply@quire.local",
    ehloName: "quire.local",
    ca: input.ca ?? fixtureCertificate,
  });
  const encrypted = new SecretBox(harness.runtime.secretKey).seal(secret, "provider:smtp");
  await harness.runtime.db.run(
    `INSERT INTO adapter_provider_configs(
    id,kind,base_url,model,encrypted_secret,policy_json,enabled,version,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      crypto.randomUUID(),
      "smtp",
      `https://127.0.0.1:${fixture.port}`,
      "implicit",
      encrypted,
      JSON.stringify(defaultPolicy),
      input.enabled === false ? 0 : 1,
      1,
      harness.clock.now(),
    ],
  );
}

export async function queue(harness: Harness, recipient = "reader@example.test"): Promise<string> {
  const id = crypto.randomUUID();
  await harness.runtime.db.run(
    `INSERT INTO mail_outbox(
    id,recipient,subject,body,dedupe_key,status,created_at
  ) VALUES(?,?,?,?,?,'local',?)`,
    [
      id,
      recipient,
      "Quire notification",
      "Durable body with unicode: Việt",
      `delivery:${id}`,
      harness.clock.now(),
    ],
  );
  return id;
}

export async function restart(harness: Harness): Promise<void> {
  await harness.delivery.close();
  await harness.adapters.close();
  await harness.runtime.close();
  const adapters = createAdapterModules({
    contributions: [smtpContribution, localMailContribution],
  });
  const delivery = createDeliveryModule();
  const config = loadConfig({
    QUIRE_DATA_DIR: harness.path,
    QUIRE_PUBLIC_URL: "http://localhost:5173",
  });
  harness.adapters = adapters;
  harness.delivery = delivery;
  harness.runtime = await createRuntime(config, {
    clock: harness.clock,
    modules: modules(adapters, delivery),
  });
}

export async function dispose(harness: Harness): Promise<void> {
  await harness.delivery.close();
  await harness.adapters.close();
  await harness.runtime.close();
  await rm(harness.path, { recursive: true, force: true });
}
