import { useCallback, useEffect, useState } from "react";
import { endpoints, MemberRoleSchema, PolicySchema } from "@quire/contracts";
import type { Invitation, Membership, Organization, Policy, ResponseOf } from "@quire/contracts";
import { Button, Field } from "../../../ui";
import { Check, mutationHeaders, Notice, Panel, Select, unwrap, useAction, value } from "../shared";
import type { SettingsProps } from "../settings";
import { OrganizationReports } from "./reports";
import { OrganizationManagement } from "./management";

type Props = SettingsProps & { readonly organizationId: string };
type Access = ResponseOf<typeof endpoints.organizationAccess>;

export function OrganizationDetail(props: Props) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [members, setMembers] = useState<readonly Membership[]>([]);
  const [invitations, setInvitations] = useState<readonly Invitation[]>([]);
  const [access, setAccess] = useState<Access | null>(null);
  const [loaded, setLoaded] = useState(false);
  const action = useAction();
  const load = useCallback(async (signal?: AbortSignal) => {
    const input = { params: { o: props.organizationId }, query: {}, body: undefined };
    const [organizationResult, accessResult] = await Promise.all([
      props.client.call(endpoints.organizationGet, input, signal),
      props.client.call(endpoints.organizationAccess, input, signal),
    ]);
    const org = unwrap(organizationResult);
    const currentAccess = unwrap(accessResult);
    const rows: Membership[] = [];
    const invites: Invitation[] = [];
    let cursor: string | undefined;
    if (currentAccess.operator || currentAccess.role === "admin" || currentAccess.role === "manager") {
      do {
        const page = unwrap(await props.client.call(endpoints.membersList, { params: { o: org.id }, query: { limit: 200, ...(cursor ? { cursor } : {}) }, body: undefined }, signal));
        rows.push(...page.items); cursor = page.nextCursor ?? undefined;
      } while (cursor);
      do {
        const page = unwrap(await props.client.call(endpoints.organizationInvitationsList, { params: { o: org.id }, query: { limit: 200, ...(cursor ? { cursor } : {}) }, body: undefined }, signal));
        invites.push(...page.items); cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    setAccess(currentAccess);
    setOrganization(org); setMembers(rows); setInvitations(invites); setLoaded(true);
  }, [props.client, props.organizationId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted && cause instanceof Error) action.setError(cause.message);
    });
    return () => controller.abort();
  }, [load, action.setError]);
  const admin = access?.role === "admin" || access?.operator === true;
  const manager = admin || access?.role === "manager";
  return <Panel title={organization?.name ?? "Organization details"}>
    <Notice {...action} />
    <Button busy={action.busy} onClick={() => { void action.run(() => load()); }}>Refresh organization</Button>
    {!loaded ? <p role="status">Loading organization details...</p> : organization && <>
      <p className="organization-access">Organization membership: <strong>{access?.role ?? "None"}</strong></p>
      <p>Installation operator: <strong>{access?.operator ? "Yes" : "No"}</strong></p>
      <p>{organization.kind} / {organization.slug} / version {organization.version}</p>
      <p>Domains: {organization.domains.join(", ") || "None"}</p>
      <h3>Members</h3>
      {!manager ? <p>Member directory and licensing require a manager or administrator. Your organization policy is shown below.</p> : <>
        <p>Membership records identify accounts by ID. Managers can manage ordinary members; administrators can manage all roles. Licensed seats remain subject to the server's billing limits.</p>
        <a href={`/api/organizations/${organization.id}/members.csv`} download="members.csv">Download members CSV</a>
        <div className="account-stack">{members.map(member => <MemberEditor key={`${member.id}:${member.version}`} member={member} admin={admin} busy={action.busy} save={async (role, licensed) => {
          await action.run(async () => {
            unwrap(await props.client.call(endpoints.memberPatch, { params: { o: organization.id, id: member.id }, query: {}, body: { role, licensed, expectedVersion: member.version } }));
            await load(); action.setMessage("Membership saved.");
          });
        }} remove={async () => {
          await action.run(async () => {
            unwrap(await props.client.call(endpoints.memberDelete, { params: { o: organization.id, id: member.id }, query: {}, body: { expectedVersion: member.version } }));
            await load(); action.setMessage("Membership removed.");
          });
        }} />)}</div>
        {organization.kind === "team" ? <><details><summary>Add an existing account</summary><p>This grants membership immediately to an active verified account. It does not send a pending invitation.</p>
          <form className="account-form" onSubmit={event => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            void action.run(async () => {
              unwrap(await props.client.call(endpoints.memberCreate, { params: { o: organization.id }, query: {}, body: { email: value(form, "email"), role: MemberRoleSchema.parse(value(form, "role")), licensed: form.has("licensed"), expectedVersion: organization.version }, headers: mutationHeaders() }));
              await load(); action.setMessage("Existing account added.");
            });
          }}>
            <Field name="email" label="Verified account email" type="email" required />
            <Select name="role" label="New member role" defaultValue="member" options={roles(admin)} />
            <Check name="licensed" label="Assign a licensed seat" checked={false} />
            <Button type="submit" busy={action.busy}>Add account</Button>
          </form>
        </details>
        <h3>Pending invitations</h3>
        <p>Recipients must sign in with the invited verified email and accept. Invitations do not create accounts or assign licensed seats.</p>
        <form className="account-form" aria-label="Invite organization member" onSubmit={event => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void action.run(async () => {
            unwrap(await props.client.call(endpoints.organizationInvitationCreate, { params: { o: organization.id }, query: {},
              body: { email: value(form, "email"), role: MemberRoleSchema.parse(value(form, "role")), expectedVersion: organization.version }, headers: mutationHeaders() }));
            await load(); action.setMessage("Organization invitation queued.");
          });
        }}>
          <Field name="email" label="Invitation email" type="email" required />
          <Select name="role" label="Invitation role" defaultValue="member" options={roles(admin)} />
          <Button type="submit" busy={action.busy}>Send invitation</Button>
        </form>
        {!invitations.some(invite => invite.status === "pending") && <p>No pending invitations.</p>}
        <div className="account-stack">{invitations.filter(invite => invite.status === "pending").map(invite =>
          <div className="organization-member account-stack" key={`${invite.id}:${invite.version}`} aria-label={`Invitation ${invite.email}`}>
            <p>{invite.email} / {invite.role}</p>
            <p>Expires <time dateTime={invite.expiresAt}>{new Date(invite.expiresAt).toLocaleString()}</time>.</p>
            {admin || invite.role === "member" ? <div className="account-actions">
              <Button busy={action.busy} onClick={() => void action.run(async () => {
                unwrap(await props.client.call(endpoints.organizationInvitationResend, { params: { o: organization.id, id: invite.id }, query: {},
                  body: { expectedVersion: invite.version }, headers: mutationHeaders() }));
                await load(); action.setMessage("Organization invitation resent.");
              })}>Resend invitation</Button>
              <Button variant="danger" busy={action.busy} onClick={() => void action.run(async () => {
                unwrap(await props.client.call(endpoints.organizationInvitationDelete, { params: { o: organization.id, id: invite.id }, query: {},
                  body: { expectedVersion: invite.version }, headers: mutationHeaders() }));
                await load(); action.setMessage("Organization invitation revoked.");
              })}>Revoke invitation</Button>
            </div> : <p>Administrator required to change this invitation.</p>}
          </div>)}</div></> : <p>Institution users must enroll themselves and retain control of their accounts. Administrators can manage roles after enrollment. <a href={`/institutions/${organization.slug}`}>Open institution enrollment</a></p>}
      </>}
      {admin && organization.kind === "team" && <OrganizationManagement {...props} organization={organization} refreshOrganization={load}
        canAuthorizeLifecycle={access?.role === "admin"} />}
      <h3>Current organization policy</h3>
      <p>This is the organization policy, not a prediction of an individual project's effective benefits.</p>
      <PolicyEditor key={organization.version} policy={organization.policy} editable={admin} busy={action.busy} save={async policy => {
        await action.run(async () => {
          unwrap(await props.client.call(endpoints.organizationPolicyPatch, { params: { o: organization.id }, query: {}, body: { ...policy, expectedVersion: organization.version } }));
          await load(); action.setMessage("Organization policy saved.");
        });
      }} />
      {manager && <OrganizationReports {...props} organization={organization} admin={admin} />}
    </>}
  </Panel>;
}

function roles(admin: boolean): readonly (readonly [string, string])[] {
  return admin ? [["member", "Member"], ["manager", "Manager"], ["admin", "Administrator"]] : [["member", "Member"]];
}
function MemberEditor({ member, admin, busy, save, remove }: {
  readonly member: Membership; readonly admin: boolean; readonly busy: boolean;
  readonly save: (role: Membership["role"], licensed: boolean) => Promise<void>; readonly remove: () => Promise<void>;
}) {
  const editable = admin || member.role === "member";
  return <form className="organization-member account-form" aria-label={`Member ${member.userId}`} onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void save(MemberRoleSchema.parse(value(form, "role")), form.has("licensed"));
  }}>
    <code>{member.userId}</code>
    {editable ? <>
      <Select label="Member role" name="role" defaultValue={member.role} options={roles(admin)} />
      <Check name="licensed" label="Licensed seat" checked={member.licensed} />
      <div className="account-actions"><Button type="submit" busy={busy}>Save member</Button><Button variant="danger" busy={busy} onClick={() => { void remove(); }}>Remove member</Button></div>
    </> : <p>{member.role} / {member.licensed ? "Licensed" : "Unlicensed"} / Administrator required to edit</p>}
  </form>;
}

function PolicyEditor({ policy, editable, busy, save }: {
  readonly policy: Policy; readonly editable: boolean; readonly busy: boolean; readonly save: (policy: Policy) => Promise<void>;
}) {
  const numbers = [["compileSeconds", "Compile timeout (seconds)"], ["writableMembers", "Writable members"], ["historyDays", "History retention (days)"], ["aiDailyUses", "AI daily uses"]] as const;
  const checks = [["trackChanges", "Track changes"], ["chat", "Chat"], ["anonymousRead", "Anonymous reading"], ["anonymousEdit", "Anonymous editing"]] as const;
  return <form className="account-form" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const numeric = Object.fromEntries(numbers.map(([name]) => [name, value(form, name) === "" ? null : Number(value(form, name))]));
    const toggles = Object.fromEntries(checks.map(([name]) => [name, form.has(name)]));
    void save(PolicySchema.parse({ ...numeric, ...toggles, ai: value(form, "ai"), sharing: value(form, "sharing") }));
  }}>
    <fieldset disabled={!editable || busy} className="organization-policy">
      <legend>{editable ? "Edit policy" : "Read-only policy (administrator required)"}</legend>
      {numbers.map(([name, label]) => <Field key={name} label={label} name={name} type="number" min={name === "compileSeconds" ? 1 : 0} max={name === "compileSeconds" ? 600 : undefined} step={1} required={name === "compileSeconds"} defaultValue={policy[name] ?? ""} />)}
      <p>Leave optional numeric limits blank for no organization limit.</p>
      <Select label="AI mode" name="ai" defaultValue={policy.ai} options={[["off", "Off"], ["ask", "Ask"], ["agent", "Agent"]]} />
      <Select label="Sharing" name="sharing" defaultValue={policy.sharing} options={[["named", "Named accounts"], ["organization", "Organization"], ["anyone", "Anyone"]]} />
      {checks.map(([name, label]) => <Check key={name} name={name} label={label} checked={policy[name]} />)}
    </fieldset>
    {editable && <Button type="submit" variant="primary" busy={busy}>Save organization policy</Button>}
  </form>;
}
