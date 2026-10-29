import { z } from "zod";
import { IdSchema, InstantSchema, DigestSchema, CountSchema, RoleSchema, CapabilitySchema } from "./primitives";
import { EngineSchema } from "./projects";
import { ImportSelectionSchema, ImportUploadSchema } from "./multipart";

export const UserSchema = z.strictObject({
  id: IdSchema, name: z.string(), primaryEmail: z.email(), verifiedEmails: z.array(z.email()).readonly(),
  managedBy: IdSchema.nullable(), avatarBlob: DigestSchema.nullable(), latexName: z.string(),
  affiliation: z.string(), orcid: z.string().nullable(), interfaceLanguage: z.enum(["en", "vi", "zh"]),
}).readonly();
export const PolicySchema = z.strictObject({
  compileSeconds: z.number().int().positive().max(600), writableMembers: CountSchema.nullable(),
  historyDays: CountSchema.nullable(), trackChanges: z.boolean(), chat: z.boolean(),
  ai: z.enum(["off", "ask", "agent"]), aiDailyUses: CountSchema.nullable(),
  sharing: z.enum(["named", "organization", "anyone"]), anonymousRead: z.boolean(), anonymousEdit: z.boolean(),
}).readonly();
export const ProjectBenefitsSchema = PolicySchema.unwrap().pick({
  compileSeconds: true, writableMembers: true, historyDays: true, trackChanges: true,
}).readonly();
export const PreferencesSchema = z.strictObject({
  theme: z.enum(["light", "dark", "system"]), bindings: z.enum(["default", "vim", "emacs"]),
  fontSize: z.number().min(10).max(24), fontFamily: z.enum(["plex", "system", "serif"]),
  lineHeight: z.enum(["compact", "normal", "wide"]), defaultView: z.enum(["source", "split", "visual", "pdf"]),
  defaultEngine: EngineSchema, dictionary: z.enum(["en-US", "en-GB", "vi", "zh"]),
  spellCheck: z.boolean(), customWords: z.array(z.string()).readonly(), viewer: z.enum(["builtin", "browser"]),
  autoCompile: z.boolean(), autocomplete: z.boolean(), autoClose: z.boolean(), cursors: z.boolean(),
  aiModel: z.string().nullable(), aiMode: z.enum(["ask", "agent"]), aiStyle: z.enum(["match", "academic", "plain"]),
  citationProviders: z.array(z.string()).readonly(), inlineCompletion: z.boolean(), errorAssist: z.boolean(),
  citationWebSearch: z.boolean(), aiBranch: z.boolean(), shareAiChat: z.boolean(),
  compileBeforeCommit: z.boolean(), version: CountSchema,
}).readonly();
export const OrganizationSchema = z.strictObject({
  id: IdSchema, slug: z.string(), name: z.string(), kind: z.enum(["team", "institution"]),
  domains: z.array(z.string()).readonly(), policy: PolicySchema, version: CountSchema,
}).readonly();
export const MemberRoleSchema = z.enum(["admin", "manager", "member"]);
export const ManagedStateSchema = z.enum(["invited", "accepted", "released", "suspended", "soft_deleted", "deleted"]);
export const ManagedLifecycleSettingsSchema = z.strictObject({
  enabled: z.boolean(), transferTo: IdSchema.nullable(),
  softDeleteDays: z.number().int().min(1).max(36500),
  deletionDays: z.number().int().min(2).max(36501),
}).refine(value => value.deletionDays > value.softDeleteDays, {
  message: "Final deletion must follow soft deletion, both measured from lapse",
}).refine(value => !value.enabled || value.transferTo !== null, {
  message: "An enabled schedule requires a managed transfer recipient",
});
export const ManagedLifecycleScheduleSchema = z.strictObject({
  settings: ManagedLifecycleSettingsSchema, version: CountSchema,
  authorizedBy: IdSchema.nullable(), authorityValid: z.boolean(),
  accounts: z.array(z.strictObject({
    userId: IdSchema, email: z.email(), state: ManagedStateSchema, version: CountSchema,
    lapseAt: InstantSchema.nullable(),
    nextStage: z.enum(["soft_deleted", "deleted"]).nullable(), nextAt: InstantSchema.nullable(),
    errorCode: z.string().nullable(),
  })),
});
export const MembershipSchema = z.strictObject({
  id: IdSchema, organizationId: IdSchema, userId: IdSchema, role: MemberRoleSchema,
  licensed: z.boolean(), version: CountSchema,
}).readonly();
export const AdminUserSummarySchema = UserSchema.unwrap().extend({
  operator: z.boolean(), suspended: z.boolean(), deletedAt: InstantSchema.nullable(),
  groups: z.array(z.strictObject({
    name: z.string(), membership: MembershipSchema,
  }).readonly()).readonly(),
  projectCount: CountSchema, lastSeenAt: InstantSchema.nullable(), version: CountSchema,
}).readonly();
export const InvitationSchema = z.strictObject({
  id: IdSchema, projectId: IdSchema.nullable(), organizationId: IdSchema.nullable(), email: z.email(),
  role: z.union([RoleSchema.exclude(["owner"]), MemberRoleSchema]),
  status: z.enum(["pending", "accepted", "revoked", "expired"]), expiresAt: InstantSchema, version: CountSchema,
}).readonly();
export const AccessRequestSchema = z.strictObject({
  id: IdSchema, projectId: IdSchema, userId: IdSchema, role: z.enum(["reviewer", "editor"]),
  message: z.string(), status: z.enum(["pending", "accepted", "declined"]), version: CountSchema,
}).readonly();
export const IdentityConfigSchema = z.strictObject({
  protocol: z.enum(["saml", "oidc", "ldap"]), enabled: z.boolean(), requireSso: z.boolean(),
  createOnLogin: z.boolean(), breakGlassUserId: IdSchema, domains: z.array(z.string()).readonly(),
  mappings: z.array(z.strictObject({
    group: z.string(), role: z.union([MemberRoleSchema, z.literal("guest")]), ai: PolicySchema.unwrap().shape.ai,
  }).readonly()).readonly(),
  attributes: z.strictObject({ email: z.string(), name: z.string(), groups: z.string() }).readonly(),
  saml: z.strictObject({
    entityId: z.string(), ssoUrl: z.string(), metadataXml: z.string(),
    certificates: z.array(z.string()).readonly(),
  }).readonly().nullable(),
  oidc: z.strictObject({
    issuer: z.string(), clientId: z.string(), scopes: z.array(z.string()).readonly(), secretPresent: z.boolean(),
  }).readonly().nullable(),
  ldap: z.strictObject({
    url: z.string(), baseDn: z.string(), bindDn: z.string(), userFilter: z.string(),
    caCertificate: z.string(), secretPresent: z.boolean(),
  }).readonly().nullable(), version: CountSchema,
}).readonly();
export const BillingAccountSchema = z.strictObject({
  id: IdSchema, organizationId: IdSchema.nullable(), userId: IdSchema.nullable(),
  provider: z.enum(["manual", "configured"]), planId: z.string().nullable(), period: z.enum(["month", "year"]),
  seats: CountSchema, status: z.enum(["unbilled", "active", "past_due", "canceled"]),
  renewsAt: InstantSchema.nullable(), invoiceEmail: z.string(), taxId: z.string(),
  address: z.string(), version: CountSchema,
}).readonly();
export const InvoiceSchema = z.strictObject({
  id: IdSchema, billingAccountId: IdSchema, providerId: z.string().nullable(), amountMinor: CountSchema,
  currency: z.string(), status: z.enum(["draft", "open", "paid", "void"]),
  issuedAt: InstantSchema, documentArtifactId: IdSchema.nullable(),
}).readonly();
export const AuditEntrySchema = z.strictObject({
  id: IdSchema, seq: CountSchema, at: InstantSchema, actorId: IdSchema.nullable(),
  organizationId: IdSchema.nullable(), event: z.string(), targetId: IdSchema, ip: z.string().nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).readonly();
export const SessionSchema = z.strictObject({
  id: IdSchema, createdAt: InstantSchema, expiresAt: InstantSchema, lastSeenAt: InstantSchema,
  current: z.boolean(), userAgent: z.string(), ip: z.string().nullable(), version: CountSchema,
}).readonly();
export const AuthOptionsSchema = z.strictObject({
  passwordEnabled: z.boolean(), registrationEnabled: z.boolean(),
  providers: z.array(z.strictObject({
    id: z.string(), label: z.string(), capability: CapabilitySchema,
  }).readonly()).readonly(),
}).readonly();
export const LinkedIdentitySchema = z.strictObject({
  id: IdSchema, issuer: z.string(), subject: z.string(), createdAt: InstantSchema,
}).readonly();
export const OnboardingChoicesSchema = z.strictObject({
  writingKind: z.enum(["paper", "thesis", "slides", "coursework"]),
  name: z.string().max(200),
  origin: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("blank") }),
    z.strictObject({ kind: z.literal("template"), templateVersionId: IdSchema }),
    z.strictObject({ kind: z.literal("import") }),
  ]),
  defaultView: z.enum(["source", "split", "visual"]),
}).readonly();
const onboardingRepositoryUrl = z.string().max(2048).refine(value => !/[@?#]/u.test(value),
  "Use a repository URL without credentials, query, or fragment; choose a saved connection");
export const OnboardingImportDraftSchema = z.strictObject({
  mode: z.enum(["upload", "github", "git"]), name: z.string().max(200),
  workspaceId: IdSchema.nullable(), url: onboardingRepositoryUrl, branch: z.string().max(200),
  grantId: IdSchema.nullable(), ...ImportSelectionSchema.unwrap().shape,
}).readonly();
export const OnboardingImportFileSchema = z.strictObject({
  filename: z.string().min(1).max(255),
  mime: z.string().regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/u),
  bytes: CountSchema, sha256: DigestSchema,
}).readonly();
export const OnboardingImportRequestSchema = z.strictObject({
  kind: z.enum(["zip", "github", "git"]), name: z.string().min(1).max(200),
  workspaceId: IdSchema.optional(),
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("upload"), uploadId: IdSchema }),
    z.strictObject({ kind: z.literal("git"), url: onboardingRepositoryUrl.pipe(z.url()),
      branch: z.string().min(1).max(200), grantId: IdSchema.optional() }),
  ]),
  ...ImportSelectionSchema.unwrap().shape,
}).readonly();
export const OnboardingImportStateSchema = z.strictObject({
  draft: OnboardingImportDraftSchema,
  attempt: z.strictObject({
    key: IdSchema, uploadKey: IdSchema.nullable(), file: OnboardingImportFileSchema.nullable(),
    upload: ImportUploadSchema.nullable(), request: OnboardingImportRequestSchema.nullable(),
    operationId: IdSchema.nullable(),
  }).readonly().nullable(),
}).readonly();
export const OnboardingSchema = z.strictObject({
  schemaVersion: z.literal(1), actorId: IdSchema, version: CountSchema,
  choices: OnboardingChoicesSchema,
  stage: z.enum(["choosing", "creating", "complete", "import"]),
  createKey: IdSchema.nullable(), projectId: IdSchema.nullable(),
  importState: OnboardingImportStateSchema.nullable().default(null),
}).readonly();
export type OnboardingChoices = z.infer<typeof OnboardingChoicesSchema>;
export type Onboarding = z.infer<typeof OnboardingSchema>;
export type OnboardingImportDraft = z.infer<typeof OnboardingImportDraftSchema>;
export type OnboardingImportFile = z.infer<typeof OnboardingImportFileSchema>;
export type OnboardingImportRequest = z.infer<typeof OnboardingImportRequestSchema>;
export type OnboardingImportState = z.infer<typeof OnboardingImportStateSchema>;
export const NotificationPreferencesSchema = z.strictObject({
  events: z.record(z.string(), z.boolean()),
  channels: z.array(z.enum(["in-app", "email"])).readonly(),
  projectOverrides: z.record(IdSchema, z.record(z.string(), z.boolean())),
  version: CountSchema,
}).readonly();
export type User = z.infer<typeof UserSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type ProjectBenefits = z.infer<typeof ProjectBenefitsSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type Membership = z.infer<typeof MembershipSchema>;
export type AdminUserSummary = z.infer<typeof AdminUserSummarySchema>;
export type Invitation = z.infer<typeof InvitationSchema>;
export type AccessRequest = z.infer<typeof AccessRequestSchema>;
export type IdentityConfig = z.infer<typeof IdentityConfigSchema>;
export type BillingAccount = z.infer<typeof BillingAccountSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export type Session = z.infer<typeof SessionSchema>;
export type AuthOptions = z.infer<typeof AuthOptionsSchema>;
export type LinkedIdentity = z.infer<typeof LinkedIdentitySchema>;
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
