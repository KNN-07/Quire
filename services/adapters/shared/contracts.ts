import { z } from "zod";
import { InstantSchema } from "@quire/contracts";
import type { AdapterGrant, Capability, Id, Policy, Transaction } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { SafeHttpClient } from "./http";
import type { ProviderConfigurations } from "./configuration";
import type { GrantStore } from "./grants";
import type { AdapterOperations } from "./operations";

export const GrantTokensSchema = z.strictObject({
  accessToken: z.string().min(1), refreshToken: z.string().min(1).nullable(),
  tokenType: z.enum(["Bearer", "Basic"]), scopes: z.array(z.string()).readonly(),
  expiresAt: InstantSchema.nullable(),
}).readonly();
export type GrantTokens = z.infer<typeof GrantTokensSchema>;
export type ProviderSettings = {
  readonly id: Id; readonly kind: string; readonly baseUrl: string; readonly model?: string;
  readonly secret: string | null; readonly enabled: boolean; readonly policy: Policy;
  readonly version: number;
};
export type OAuthConfiguration = {
  readonly authorizationUrl: string; readonly tokenUrl: string; readonly revokeUrl?: string;
  readonly clientId: string; readonly clientSecret?: string;
  readonly scopes: readonly string[];
  readonly tokenAuthentication: "body" | "basic" | "none";
  readonly authorizationParameters?: Readonly<Record<string, string>>;
};
export type GrantContext = {
  readonly actorId: Id; readonly grant: AdapterGrant; readonly tokens: GrantTokens;
  readonly configuration: ProviderSettings; readonly signal: AbortSignal;
};
export type ActionContext = GrantContext & {
  readonly projectId?: Id; readonly expectedCursor: string | null; readonly key: string;
};
export type PreparedAction = {
  readonly result: Readonly<Record<string, unknown>>; readonly cursor: string | null;
  /** SQL/fence checks only. Provider I/O and Git preparation have already completed. */
  readonly publish?: (tx: Transaction) => Promise<void>;
  /** Release prepared leases/files outside SQL, after success or failure. */
  readonly release?: () => Promise<void>;
};
export type AdapterActionDefinition = {
  readonly projectAccess: "none" | "read" | "write" | "owner";
  readonly prepare: (parameters: Readonly<Record<string, unknown>>, context: ActionContext) => Promise<PreparedAction>;
};
export function defineAction<T extends z.ZodType>(
  schema: T,
  action: {
    readonly projectAccess: AdapterActionDefinition["projectAccess"];
    readonly prepare: (parameters: z.output<T>, context: ActionContext) => Promise<PreparedAction>;
  },
): AdapterActionDefinition {
  return { projectAccess: action.projectAccess, prepare: (parameters, context) => action.prepare(schema.parse(parameters), context) };
}
export type AdapterDefinition = {
  readonly kind: string; readonly label: string;
  /** Names every missing credential, purchased API contract or installed executable. */
  readonly configuration: (settings: ProviderSettings) => readonly string[];
  readonly oauth?: (settings: ProviderSettings) => OAuthConfiguration;
  readonly actions: Readonly<Record<string, AdapterActionDefinition>>;
  readonly test: (context: GrantContext) => Promise<{ readonly ok: boolean; readonly reason?: string }>;
  readonly probe?: (settings: ProviderSettings) => Promise<{ readonly ok: boolean; readonly reason?: string }>;
  /** "local" explicitly forgets saved credentials without claiming upstream revocation. */
  readonly revoke?: "local" | ((context: GrantContext) => Promise<void>);
  readonly close?: () => Promise<void>;
};
export type AdapterServices = {
  readonly context: ModuleContext; readonly http: SafeHttpClient;
  readonly configuration: ProviderConfigurations; readonly grants: GrantStore;
  readonly operations: AdapterOperations;
};
export type AdapterContribution = (services: AdapterServices) => AdapterDefinition;
export function configurationCapability(definition: AdapterDefinition, settings: ProviderSettings): Capability {
  const missing = [...(settings.version === 0 ? ["operator provider configuration"] : []),
    ...definition.configuration(settings)];
  if (missing.length) return { enabled: false, state: "unconfigured", reason: `Missing: ${missing.join("; ")}` };
  if (!settings.enabled) return { enabled: false, state: "disabled", reason: "Provider disabled by operator" };
  return { enabled: true, state: "ready" };
}
