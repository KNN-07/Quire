import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, ServiceModule } from "@quire/runtime";
import { createAdapterModules } from "./shared";
import type { SafeHttpClient } from "./shared";
import { createIdentityModule, identityDefinition, identityProfiles } from "./identity";
import type { IdentityProfile } from "./identity";
import { createFederationModules } from "./federation";
import type { FederationDeployment } from "./federation";
import { createRemoteGitIntegration } from "./remote-git";
import type { RemoteGitOptions } from "./remote-git";
import { createReferencesModules } from "./references";
import type { SyncTicker } from "./references";
import { createInterchangeModule, PandocConverter } from "./interchange";
import { createDropboxIntegration } from "./dropbox";
import type { DropboxOptions } from "./dropbox";
import { createAiModules } from "./ai";
import type { AiOptions } from "./ai";
import { createBillingModules, stripeBillingContribution } from "./billing";
import { publisherContribution, publisherModule } from "./publisher";
import { createDeliveryModule, smtpContribution, localMailContribution } from "./delivery";
import { defaultPolicy } from "../accounts/identity/policy";
import { flushNotificationDigests } from "../accounts/governance/notifications";
import type { InquiryOutbox } from "../operations/support";

export type AdapterDeployment = {
  readonly supportRecipient?: string;
  readonly http?: SafeHttpClient;
  readonly identityProfiles?: readonly IdentityProfile[];
  readonly federation?: FederationDeployment;
  readonly remoteGit?: RemoteGitOptions;
  readonly dropbox?: DropboxOptions;
  readonly ai?: Omit<AiOptions, "retrieval">;
  readonly converter?: PandocConverter;
  /** One host-owned wake interval; provider-specific due times still apply. */
  readonly schedulerIntervalMs?: number;
  readonly schedulerTicks?: SyncTicker;
};

/** Credentials remain in encrypted provider configuration, not this environment. */
export function loadAdapterDeployment(env: NodeJS.ProcessEnv = process.env): AdapterDeployment {
  const parsed = z.object({
    QUIRE_SUPPORT_RECIPIENT: z.email().optional(),
    QUIRE_ADAPTER_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1_000).max(86_400_000).optional(),
    QUIRE_DROPBOX_APP_KEY: z.string().min(1).optional(),
    QUIRE_DROPBOX_APP_FOLDER: z.literal("Apps/Quire").optional(),
    QUIRE_AI_TERMS_VERSION: z.string().min(1).optional(),
    QUIRE_AI_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).optional(),
    QUIRE_AI_VISION_MODELS: z.string().transform(value => value.split(",").map(model => model.trim()))
      .pipe(z.array(z.string().min(1))).optional(),
    QUIRE_FEDERATION_ORGANIZATION_ID: IdSchema.optional(),
    QUIRE_FEDERATION_TRANSFER_TO: IdSchema.optional(),
    QUIRE_FEDERATION_LDAP_ALLOWED_URLS: z.string().transform(value => value.split(",").map(url => url.trim()))
      .pipe(z.array(z.url())).optional(),
    QUIRE_FEDERATION_LDAP_SUBJECT_ATTRIBUTE: z.string().min(1).optional(),
  }).parse(env);
  return {
    ...(parsed.QUIRE_SUPPORT_RECIPIENT ? { supportRecipient: parsed.QUIRE_SUPPORT_RECIPIENT } : {}),
    ...(parsed.QUIRE_ADAPTER_SCHEDULER_INTERVAL_MS !== undefined
      ? { schedulerIntervalMs: parsed.QUIRE_ADAPTER_SCHEDULER_INTERVAL_MS } : {}),
    dropbox: {
      ...(parsed.QUIRE_DROPBOX_APP_KEY ? { appKey: parsed.QUIRE_DROPBOX_APP_KEY } : {}),
      ...(parsed.QUIRE_DROPBOX_APP_FOLDER ? { appFolder: parsed.QUIRE_DROPBOX_APP_FOLDER } : {}),
    },
    ai: {
      ...(parsed.QUIRE_AI_TERMS_VERSION ? { termsVersion: parsed.QUIRE_AI_TERMS_VERSION } : {}),
      ...(parsed.QUIRE_AI_RETENTION_DAYS ? { retentionDays: parsed.QUIRE_AI_RETENTION_DAYS } : {}),
      ...(parsed.QUIRE_AI_VISION_MODELS ? { visionModels: parsed.QUIRE_AI_VISION_MODELS } : {}),
    },
    federation: {
      ...(parsed.QUIRE_FEDERATION_ORGANIZATION_ID ? { organizationId: parsed.QUIRE_FEDERATION_ORGANIZATION_ID } : {}),
      ...(parsed.QUIRE_FEDERATION_TRANSFER_TO ? { transferTo: parsed.QUIRE_FEDERATION_TRANSFER_TO } : {}),
      ...(parsed.QUIRE_FEDERATION_LDAP_ALLOWED_URLS ? { ldapAllowedUrls: parsed.QUIRE_FEDERATION_LDAP_ALLOWED_URLS } : {}),
      ...(parsed.QUIRE_FEDERATION_LDAP_SUBJECT_ATTRIBUTE
        ? { ldapSubjectAttribute: parsed.QUIRE_FEDERATION_LDAP_SUBJECT_ATTRIBUTE } : {}),
    },
  };
}

/** Fresh per application, with one shared provider registry and one import/link dispatcher. */
export function createApplicationAdapters(options: AdapterDeployment = loadAdapterDeployment()) {
  const supportRecipient = z.email().nullable().parse(options.supportRecipient ?? null);
  const interval = z.number().int().min(1_000).max(86_400_000).parse(options.schedulerIntervalMs ?? 30_000);
  const transport = options.http ? { http: options.http } : {};
  const references = createReferencesModules();
  const remoteGit = createRemoteGitIntegration(options.remoteGit);
  const dropbox = createDropboxIntegration(options.dropbox);
  const converter = options.converter ?? new PandocConverter();
  const interchange = createInterchangeModule({ ...transport, converter, bibliographyLinks: references.links });
  const ai = createAiModules({ ...transport, ...options.ai, retrieval: () => references.retrieval });
  const billing = createBillingModules(transport);
  const federation = createFederationModules({ ...options.federation, ...transport });
  const delivery = createDeliveryModule();
  const profiles = options.identityProfiles ?? identityProfiles;
  const shared = createAdapterModules({
    ...transport,
    contributions: [
      ...profiles.map(profile => () => identityDefinition(profile)),
      ...remoteGit.contributions, ...references.contributions, dropbox.contribution,
      ...ai.contributions, stripeBillingContribution, publisherContribution,
      smtpContribution, localMailContribution,
    ],
  });
  let context: ModuleContext | undefined;
  let started = false;
  let closing: Promise<void> | undefined;
  const subscriptions: (() => void)[] = [];
  const running = new Set<Promise<unknown>>();
  const failures: unknown[] = [];
  const modules: readonly ServiceModule[] = [
    { id: "059-x-local-mail", lane: "X", order: 59, async register(runtime) {
      await runtime.uow.run(async tx => {
        await tx.lock("adapter:provider:localMail");
        await tx.run(`INSERT INTO adapter_provider_configs(id,kind,base_url,policy_json,enabled,version,updated_at)
          VALUES(?,'localMail','',?,1,1,?) ON CONFLICT(kind) DO NOTHING`,
        [crypto.randomUUID(), JSON.stringify(defaultPolicy), runtime.clock.now()]);
      });
    } },
    shared.connections, shared.providers, createIdentityModule({ ...transport, profiles }),
    remoteGit.module, delivery.module, references.module, dropbox.module, interchange.module,
    federation.callbacks, federation.administration, publisherModule,
    billing.merchant, billing.portal, ai.module,
    { id: "070-x-adapter-lifecycle", lane: "X", order: 70, register(runtime) { context = runtime; } },
  ];
  const inquiries: InquiryOutbox = {
    recipient: () => supportRecipient,
    async enqueue(tx, inquiry) {
      if (!context) throw new ServiceError("ADAPTERS_UNREGISTERED", 503, "Register application adapter modules before enqueue");
      if (!supportRecipient) throw new ServiceError("SUPPORT_UNCONFIGURED", 503, "No support recipient is configured");
      await tx.run(`INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,status,created_at)
        VALUES(?,?,'Quire support inquiry',?,?,'local',?) ON CONFLICT(dedupe_key) DO NOTHING`,
      [crypto.randomUUID(), supportRecipient, JSON.stringify(inquiry), `support:${inquiry.id}`, context.clock.now()]);
    },
  };
  return {
    modules, references, remoteGit, dropbox, interchange, ai, delivery, converter, inquiries,
    start() {
      if (closing) throw new ServiceError("ADAPTERS_CLOSED", 503, "Application adapters are closed");
      if (started) return;
      const runtime = context;
      if (!runtime) throw new ServiceError("ADAPTERS_UNREGISTERED", 503, "Register application adapter modules before start");
      started = true;
      const ticks = options.schedulerTicks ?? { subscribe(listener: () => void) {
        const timer = setInterval(listener, interval);
        timer.unref();
        return () => clearInterval(timer);
      } };
      for (const task of [
        () => references.scheduler.runDue(),
        () => dropbox.scheduler.pump(),
        async () => {
          await flushNotificationDigests(runtime);
          return delivery.drain();
        },
      ]) {
        let active = false;
        const stop = ticks.subscribe(() => {
          if (active) return;
          active = true;
          const work = runtime.admission.background<unknown>(task);
          running.add(work);
          void work.then(
            () => { active = false; running.delete(work); },
            error => { active = false; running.delete(work); failures.push(error); stop(); },
          );
        });
        subscriptions.push(stop);
      }
    },
    close(): Promise<void> {
      closing ??= (async () => {
        for (const stop of subscriptions) stop();
        await Promise.allSettled(running);
        // Every cleanup runs even when a sibling reports a persistence failure.
        for (const close of [() => ai.close(), () => interchange.close(), () => references.close(),
          () => delivery.close(), () => shared.close()]) {
          try { await close(); }
          catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, "Application adapter shutdown failed");
      })();
      return closing;
    },
  };
}
