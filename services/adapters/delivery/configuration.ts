import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { ProviderSettings } from "../shared";
import { SecretBox } from "../shared/secrets";

const SmtpSecretSchema = z
  .strictObject({
    username: z.string().min(1),
    password: z.string().min(1),
    from: z.email(),
    ehloName: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/),
    ca: z.string().min(1).optional(),
  })
  .readonly();

const ProviderRowSchema = z
  .object({
    id: z.string(),
    base_url: z.string(),
    model: z.string().nullable(),
    encrypted_secret: z.instanceof(Uint8Array).nullable(),
    enabled: z.number().int(),
    version: z.number().int(),
  })
  .readonly();

export type SmtpSettings = {
  readonly host: string;
  readonly port: number;
  readonly tls: "starttls" | "implicit";
  readonly username: string;
  readonly password: string;
  readonly from: string;
  readonly ehloName: string;
  readonly ca?: string;
  readonly version: number;
};

export type SmtpAvailability =
  | { readonly state: "ready"; readonly settings: SmtpSettings }
  | { readonly state: "unconfigured" | "disabled"; readonly reason: string };

function missing(settings: ProviderSettings): readonly string[] {
  const absent: string[] = [];
  if (!settings.baseUrl) absent.push("SMTP host URL");
  if (settings.model !== "starttls" && settings.model !== "implicit") {
    absent.push("TLS mode model (starttls or implicit)");
  }
  if (settings.secret === null) absent.push("encrypted SMTP username/password/from identity");
  if (settings.secret !== null && !validSecret(settings.secret)) {
    absent.push("valid encrypted SMTP credential document");
  }
  return absent;
}

function validSecret(value: string): boolean {
  try {
    return SmtpSecretSchema.safeParse(JSON.parse(value)).success;
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

export function parseSmtpSettings(settings: ProviderSettings): SmtpAvailability {
  const absent = [
    ...(settings.version === 0 ? ["operator SMTP provider configuration"] : []),
    ...missing(settings),
  ];
  if (absent.length > 0) return { state: "unconfigured", reason: `Missing: ${absent.join("; ")}` };
  if (!settings.enabled) return { state: "disabled", reason: "SMTP provider disabled by operator" };
  const endpoint = new URL(settings.baseUrl);
  const secret = SmtpSecretSchema.parse(JSON.parse(settings.secret ?? ""));
  const tls = z.enum(["starttls", "implicit"]).parse(settings.model);
  return {
    state: "ready",
    settings: {
      host: endpoint.hostname,
      port: endpoint.port
        ? z.coerce.number().int().min(1).max(65535).parse(endpoint.port)
        : tls === "implicit"
          ? 465
          : 587,
      tls,
      username: secret.username,
      password: secret.password,
      from: secret.from,
      ehloName: secret.ehloName,
      ...(secret.ca === undefined ? {} : { ca: secret.ca }),
      version: settings.version,
    },
  };
}

export async function smtpAvailability(context: ModuleContext): Promise<SmtpAvailability> {
  const value = await context.db.get("SELECT * FROM adapter_provider_configs WHERE kind='smtp'");
  if (!value) {
    return {
      state: "unconfigured",
      reason:
        "Missing: operator SMTP provider configuration; SMTP host URL; TLS mode model (starttls or implicit); encrypted SMTP username/password/from identity",
    };
  }
  const row = ProviderRowSchema.parse(value);
  const secret =
    row.encrypted_secret === null
      ? null
      : new SecretBox(context.secretKey).open(row.encrypted_secret, "provider:smtp");
  return parseSmtpSettings({
    id: IdSchema.parse(row.id),
    kind: "smtp",
    baseUrl: row.base_url,
    ...(row.model === null ? {} : { model: row.model }),
    secret,
    enabled: row.enabled === 1,
    policy: {
      compileSeconds: 180,
      writableMembers: null,
      historyDays: null,
      trackChanges: true,
      chat: true,
      ai: "off",
      aiDailyUses: null,
      sharing: "named",
      anonymousRead: false,
      anonymousEdit: false,
    },
    version: row.version,
  });
}
