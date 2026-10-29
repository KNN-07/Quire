import { z } from "zod";
import { routesFor, none, noBody, list, version, key } from "./route-builders";
import { IdSchema as id, InstantSchema, CountSchema, CapabilitySchema, OkSchema, pageSchema } from "./primitives";
import { IdParamsSchema as ids, BytesSchema } from "./endpoint";
import { UserSchema, PreferencesSchema, SessionSchema, OrganizationSchema, MembershipSchema,
  MemberRoleSchema, ManagedStateSchema, InvitationSchema, PolicySchema, AuditEntrySchema, BillingAccountSchema, IdentityConfigSchema,
  AuthOptionsSchema, LinkedIdentitySchema, NotificationPreferencesSchema, InvoiceSchema, ProjectBenefitsSchema } from "./accounts";
import { OperationSchema } from "./work";
import { AvatarUploadSchema, SamlCallbackSchema } from "./multipart";
import { OnboardingChoicesSchema, OnboardingSchema, OnboardingImportDraftSchema, OnboardingImportFileSchema } from "./accounts";
import { ManagedLifecycleSettingsSchema, ManagedLifecycleScheduleSchema } from "./accounts";

const r = routesFor("A");
const operator = routesFor("O");
const adapter = routesFor("X");
const email = z.email();
const password = z.string().min(12).max(1024);
const token = z.string().min(1);
const provider = z.strictObject({ provider: z.string().min(1) });
const org = z.strictObject({ o: id });
const orgId = org.extend({ id });
const existing = z.strictObject(version);
const ok = OkSchema;
const benefitParams = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("deployment"), key: z.literal("local") }),
  z.strictObject({ kind: z.literal("user"), key: id }),
  z.strictObject({ kind: z.literal("plan"), key: z.string().regex(/^(manual|configured):\S+$/) }),
]);
const benefitSet = z.strictObject({ benefits: ProjectBenefitsSchema.nullable(), version: CountSchema });
const metrics = z.strictObject({
  from: InstantSchema, to: InstantSchema, activeUsers: CountSchema, activeProjects: CountSchema,
  compileCount: CountSchema, compileMs: CountSchema, storageBytes: CountSchema, aiUses: CountSchema,
});
const management = z.strictObject({ id, state: ManagedStateSchema, version: CountSchema });
const managedMember = z.strictObject({
  id, name: z.string(), email, member: MembershipSchema, userVersion: CountSchema,
  management: management.nullable(), canInvite: z.boolean(), canRelease: z.boolean(),
  canDelete: z.boolean(), canReceiveProjects: z.boolean(),
});
export const accountEndpoints = {
  onboardingGet: r("GET", "/api/me/onboarding", { params: none, query: none, body: noBody, output: OnboardingSchema }),
  onboardingSave: r("PATCH", "/api/me/onboarding", { params: none, query: none, body: z.strictObject({ actorId: id, choices: OnboardingChoicesSchema, ...version }), output: OnboardingSchema, ...key }),
  onboardingStart: r("POST", "/api/me/onboarding/start", { params: none, query: none, body: z.strictObject({ actorId: id, ...version }), output: OnboardingSchema, ...key }),
  onboardingComplete: r("POST", "/api/me/onboarding/complete", { params: none, query: none, body: z.strictObject({ actorId: id, ...version }), output: OnboardingSchema, ...key }),
  onboardingImportSave: r("PATCH", "/api/me/onboarding/import", { params: none, query: none, body: z.strictObject({ actorId: id, draft: OnboardingImportDraftSchema, ...version }), output: OnboardingSchema, ...key }),
  onboardingImportStart: r("POST", "/api/me/onboarding/import/start", { params: none, query: none, body: z.strictObject({ actorId: id, file: OnboardingImportFileSchema.nullable(), ...version }), output: OnboardingSchema, ...key }),
  onboardingImportRecover: r("POST", "/api/me/onboarding/import/recover", { params: none, query: none, body: z.strictObject({ actorId: id }), output: z.strictObject({ progress: OnboardingSchema, operation: OperationSchema.nullable() }) }),
  adminProjectBenefitsGet: r("GET", "/api/admin/project-benefits/:kind/:key", { params: benefitParams, query: none, body: noBody, output: benefitSet }),
  adminProjectBenefitsPut: r("PUT", "/api/admin/project-benefits/:kind/:key", { params: benefitParams, query: none, body: z.strictObject({ benefits: ProjectBenefitsSchema.nullable(), ...version }), output: benefitSet }),
  authOptions: r("GET", "/api/auth/options", { params: none, query: none, body: noBody, output: AuthOptionsSchema }),
  authDiscover: r("GET", "/api/auth/discover", { params: none, query: z.strictObject({
    domain: z.string().trim().toLowerCase().max(253).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/),
  }), body: noBody, output: z.strictObject({ organizations: z.array(z.strictObject({
    id, name: z.string(), provider: z.enum(["oidc", "saml", "ldap"]), capability: CapabilitySchema,
  })) }) }),
  authRegister: r("POST", "/api/auth/register", { params: none, query: none, body: z.strictObject({ name: z.string().min(1), email, password }), output: z.strictObject({ verificationRequired: z.boolean() }), ...key }),
  authVerifyEmail: r("POST", "/api/auth/verify-email", { params: none, query: none, body: z.strictObject({ token }), output: ok }),
  authLogin: r("POST", "/api/auth/login", { params: none, query: none, body: z.strictObject({ email, password: z.string() }), output: UserSchema }),
  ldapLogin: r("POST", "/api/auth/ldap/login", { params: none, query: none, body: z.strictObject({ username: z.string().min(1), password: z.string().min(1), returnTo: z.string() }), output: UserSchema }),
  authLogout: r("POST", "/api/auth/logout", { params: none, query: none, body: none, output: ok }),
  me: r("GET", "/api/me", { params: none, query: none, body: noBody, output: z.strictObject({ user: UserSchema, preferences: PreferencesSchema, capabilities: z.record(z.string(), CapabilitySchema), csrfToken: z.string() }) }),
  passwordReset: r("POST", "/api/auth/password-reset", { params: none, query: none, body: z.strictObject({ email }), output: ok }),
  passwordResetConfirm: r("POST", "/api/auth/password-reset/confirm", { params: none, query: none, body: z.strictObject({ token, password }), output: ok }),
  sessionList: r("GET", "/api/me/sessions", { params: none, query: list, body: noBody, output: pageSchema(SessionSchema) }),
  sessionDelete: r("DELETE", "/api/me/sessions/:id", { params: ids, query: none, body: existing, output: ok }),
  sessionRevokeOthers: r("POST", "/api/me/sessions/revoke-others", { params: none, query: none, body: none, output: ok }),
  identityStart: r("GET", "/api/auth/:provider/start", { params: provider, query: z.strictObject({ returnTo: z.string() }), body: noBody, output: BytesSchema, transport: "bytes" }),
  identityCallback: r("GET", "/api/auth/:provider/callback", { params: provider, query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }), body: noBody, output: BytesSchema, transport: "bytes" }),
  samlCallback: r("POST", "/api/auth/saml/acs", { params: none, query: none, body: SamlCallbackSchema, output: BytesSchema, transport: "multipart" }),
  identityLink: r("POST", "/api/me/identities/:provider/link", { params: provider, query: none, body: existing, output: ok }),
  identitiesList: r("GET", "/api/me/identities", { params: none, query: list, body: noBody, output: pageSchema(LinkedIdentitySchema) }),
  identityUnlink: r("DELETE", "/api/me/identities/:id", { params: ids, query: none, body: existing, output: ok }),
  profilePatch: r("PATCH", "/api/me", { params: none, query: none, body: UserSchema.unwrap().pick({ name: true, latexName: true, affiliation: true, orcid: true, interfaceLanguage: true }).partial().extend(version), output: UserSchema }),
  avatarGet: r("GET", "/api/me/avatar", { params: none, query: none, body: noBody, output: BytesSchema, transport: "bytes" }),
  avatarPut: r("PUT", "/api/me/avatar", { params: none, query: none, body: AvatarUploadSchema, output: UserSchema, transport: "multipart", ifMatch: true }),
  avatarDelete: r("DELETE", "/api/me/avatar", { params: none, query: none, body: existing, output: ok }),
  preferencesGet: r("GET", "/api/me/preferences", { params: none, query: none, body: noBody, output: PreferencesSchema }),
  preferencesPatch: r("PATCH", "/api/me/preferences", { params: none, query: none, body: PreferencesSchema.unwrap().omit({ version: true }).partial().extend(version), output: PreferencesSchema }),
  emailAdd: r("POST", "/api/me/emails", { params: none, query: none, body: z.strictObject({ email, ...version }), output: ok, ...key }),
  emailDelete: r("DELETE", "/api/me/emails", { params: none, query: none, body: z.strictObject({ email, ...version }), output: ok }),
  aiConsent: r("POST", "/api/me/ai-consent", { params: none, query: none, body: z.strictObject({ termsVersion: z.string(), accepted: z.boolean(), ...version }), output: ok }),
  accountExport: r("POST", "/api/me/export", { params: none, query: none, body: none, output: OperationSchema, ...key, successStatus: 202 }),
  accountDelete: r("DELETE", "/api/me", { params: none, query: none, body: z.strictObject({ confirmation: z.string(), password: z.string().optional(), reassignment: z.record(z.string(), id).optional(), ...version }), output: ok }),
  notificationsList: r("GET", "/api/notifications", { params: none, query: list, body: noBody, output: pageSchema(z.strictObject({ id, kind: z.string(), resourceId: id, read: z.boolean(), createdAt: InstantSchema, version: CountSchema })) }),
  notificationRead: r("POST", "/api/notifications/:id/read", { params: ids, query: none, body: existing, output: ok }),
  notificationPreferencesGet: r("GET", "/api/me/notification-preferences", { params: none, query: none, body: noBody, output: NotificationPreferencesSchema }),
  notificationPreferences: r("PATCH", "/api/me/notification-preferences", { params: none, query: none, body: NotificationPreferencesSchema.unwrap().omit({ version: true }).extend(version), output: ok }),
  organizationsList: r("GET", "/api/organizations", { params: none, query: list, body: noBody, output: pageSchema(OrganizationSchema) }),
  organizationGet: r("GET", "/api/organizations/:o", { params: org, query: none, body: noBody, output: OrganizationSchema }),
  organizationAccess: r("GET", "/api/organizations/:o/access", { params: org, query: none, body: noBody, output: z.strictObject({ role: MemberRoleSchema.nullable(), operator: z.boolean() }) }),
  organizationCreate: r("POST", "/api/organizations", { params: none, query: none, body: OrganizationSchema.unwrap().pick({ name: true, kind: true, domains: true }), output: OrganizationSchema, ...key }),
  organizationPatch: r("PATCH", "/api/organizations/:o", { params: org, query: none, body: OrganizationSchema.unwrap().pick({ name: true, kind: true, domains: true }).partial().extend(version), output: OrganizationSchema }),
  organizationDelete: r("DELETE", "/api/organizations/:o", { params: org, query: none, body: existing, output: ok }),
  membersList: r("GET", "/api/organizations/:o/members", { params: org, query: list, body: noBody, output: pageSchema(MembershipSchema) }),
  organizationInvitationsList: r("GET", "/api/organizations/:o/invitations", { params: org, query: list, body: noBody, output: pageSchema(InvitationSchema) }),
  organizationInvitationCreate: r("POST", "/api/organizations/:o/invitations", { params: org, query: none, body: z.strictObject({ email, role: MemberRoleSchema, ...version }), output: InvitationSchema, ...key }),
  organizationInvitationGet: r("GET", "/api/organization-invitations/:id", { params: ids, query: none, body: noBody, output: z.strictObject({ invitation: InvitationSchema, organizationName: z.string() }) }),
  organizationInvitationAccept: r("POST", "/api/organization-invitations/:id/accept", { params: ids, query: none, body: z.strictObject({ token, ...version }), output: MembershipSchema, ...key }),
  organizationInvitationResend: r("POST", "/api/organizations/:o/invitations/:id/resend", { params: orgId, query: none, body: existing, output: InvitationSchema, ...key }),
  organizationInvitationDelete: r("DELETE", "/api/organizations/:o/invitations/:id", { params: orgId, query: none, body: existing, output: ok, ...key }),
  memberCreate: r("POST", "/api/organizations/:o/members", { params: org, query: none, body: z.strictObject({ userId: id.optional(), email: email.optional(), role: MemberRoleSchema, licensed: z.boolean(), ...version }), output: MembershipSchema, ...key }),
  memberPatch: r("PATCH", "/api/organizations/:o/members/:id", { params: orgId, query: none, body: z.strictObject({ role: MemberRoleSchema.optional(), licensed: z.boolean().optional(), ...version }), output: MembershipSchema }),
  memberDelete: r("DELETE", "/api/organizations/:o/members/:id", { params: orgId, query: none, body: existing, output: ok }),
  membersCsv: r("GET", "/api/organizations/:o/members.csv", { params: org, query: none, body: noBody, output: BytesSchema, transport: "bytes" }),
  organizationPolicy: r("GET", "/api/organizations/:o/policy", { params: org, query: none, body: noBody, output: PolicySchema }),
  organizationPolicyPatch: r("PATCH", "/api/organizations/:o/policy", { params: org, query: none, body: PolicySchema.unwrap().partial().extend(version), output: PolicySchema }),
  organizationMetrics: r("GET", "/api/organizations/:o/metrics", { params: org, query: z.strictObject({ from: InstantSchema, to: InstantSchema }), body: noBody, output: metrics }),
  organizationAudit: r("GET", "/api/organizations/:o/audit", { params: org, query: list, body: noBody, output: pageSchema(AuditEntrySchema) }),
  organizationAuditExport: r("POST", "/api/organizations/:o/audit/export", { params: org, query: none, body: none, output: OperationSchema, ...key, successStatus: 202 }),
  institutionGet: r("GET", "/api/institutions/:slug", { params: z.strictObject({ slug: z.string() }), query: none, body: noBody, output: OrganizationSchema }),
  institutionEnroll: r("POST", "/api/institutions/:slug/enroll", { params: z.strictObject({ slug: z.string() }), query: none, body: none, output: MembershipSchema, ...key }),
  managedInvite: r("POST", "/api/organizations/:o/managed/invite", { params: org, query: none, body: z.strictObject({ userId: id, ...version }), output: ok, ...key }),
  managedLifecycleGet: r("GET", "/api/organizations/:o/managed-lifecycle", { params: org, query: none, body: noBody, output: ManagedLifecycleScheduleSchema }),
  managedLifecyclePut: r("PUT", "/api/organizations/:o/managed-lifecycle", { params: org, query: none, body: z.strictObject({ settings: ManagedLifecycleSettingsSchema, ...version }), output: ManagedLifecycleScheduleSchema }),
  managedLifecycleTransition: r("POST", "/api/organizations/:o/managed/:u/lifecycle", { params: org.extend({ u: id }), query: none, body: z.strictObject({ action: z.enum(["lapse", "recover"]), ...version }), output: ok }),
  organizationManagementList: r("GET", "/api/organizations/:o/managed", { params: org, query: list, body: noBody, output: pageSchema(managedMember) }),
  managementList: r("GET", "/api/me/management", { params: none, query: list, body: noBody, output: pageSchema(management.extend({ organizationId: id, organizationName: z.string(), canAccept: z.boolean() })) }),
  managedAccept: r("POST", "/api/managed/:id/accept", { params: ids, query: none, body: existing, output: ok, ...key }),
  managedRelease: r("POST", "/api/organizations/:o/managed/:u/release", { params: org.extend({ u: id }), query: none, body: existing, output: ok }),
  managedDelete: r("POST", "/api/organizations/:o/managed/:u/delete", { params: org.extend({ u: id }), query: none, body: z.strictObject({ transferTo: id, ...version }), output: ok }),
  billingCatalog: r("GET", "/api/billing/catalog", { params: none, query: none, body: noBody, output: z.strictObject({ configured: z.boolean(), plans: z.array(z.strictObject({ id: z.string(), name: z.string(), amountMinor: CountSchema, currency: z.string(), period: z.enum(["month", "year"]) })) }) }),
  billingGet: r("GET", "/api/organizations/:o/billing", { params: org, query: none, body: noBody, output: BillingAccountSchema }),
  billingInvoices: r("GET", "/api/organizations/:o/billing/invoices", { params: org, query: list, body: noBody, output: pageSchema(InvoiceSchema) }),
  billingPortal: adapter("POST", "/api/organizations/:o/billing/portal", { params: org, query: none, body: existing, output: z.strictObject({ url: z.url() }), ...key }),
  billingPreview: r("POST", "/api/organizations/:o/billing/preview", { params: org, query: none, body: z.strictObject({ planId: z.string(), seats: CountSchema, period: z.enum(["month", "year"]), ...version }), output: z.strictObject({ quoteId: id, amountMinor: CountSchema, currency: z.string(), expiresAt: InstantSchema }), ...key }),
  billingCheckout: r("POST", "/api/organizations/:o/billing/checkout", { params: org, query: none, body: z.strictObject({ quoteId: id, ...version }), output: OperationSchema, ...key, successStatus: 202 }),
  billingDetails: r("PATCH", "/api/organizations/:o/billing/details", { params: org, query: none, body: z.strictObject({ invoiceEmail: email, taxId: z.string(), address: z.string(), ...version }), output: BillingAccountSchema }),
  billingCancel: r("POST", "/api/organizations/:o/billing/cancel", { params: org, query: none, body: z.strictObject({ atPeriodEnd: z.boolean(), ...version }), output: OperationSchema, ...key, successStatus: 202 }),
  invoiceDownload: r("GET", "/api/organizations/:o/billing/invoices/:id/download", { params: orgId, query: none, body: noBody, output: BytesSchema, transport: "bytes" }),
  billingWebhook: r("POST", "/api/webhooks/billing/:provider", { params: provider, query: none, body: BytesSchema, output: ok, transport: "bytes" }),
  identityConfigGet: operator("GET", "/api/admin/identity", { params: none, query: none, body: noBody, output: IdentityConfigSchema }),
  identityConfigPut: operator("PUT", "/api/admin/identity", { params: none, query: none, body: IdentityConfigSchema.unwrap().omit({ version: true }).extend({ ...version, oidcSecret: z.string().optional(), ldapSecret: z.string().optional() }), output: IdentityConfigSchema, ifMatch: true }),
  identityTest: operator("POST", "/api/admin/identity/test", { params: none, query: none, body: z.strictObject({ draftConfig: IdentityConfigSchema, nonce: z.string(), oidcSecret: z.string().optional(), ldapSecret: z.string().optional(), ldapUsername: z.string().min(1).optional(), ldapPassword: z.string().min(1).optional() }), output: OperationSchema, ...key, successStatus: 202 }),
  identityMetadata: operator("GET", "/api/admin/identity/metadata.xml", { params: none, query: none, body: noBody, output: BytesSchema, transport: "bytes" }),
  scimToken: operator("POST", "/api/admin/scim/token", { params: none, query: none, body: none, output: z.strictObject({ id, secretOnce: z.string() }), ...key }),
  identityBreakGlass: operator("POST", "/api/admin/identity/break-glass", { params: none, query: none, body: z.strictObject({ password }), output: ok }),
  identityCertificates: operator("POST", "/api/admin/identity/certificates", { params: none, query: none, body: z.strictObject({ certificates: z.array(z.string().min(1)).min(1), ...version }), output: IdentityConfigSchema }),
} as const;
