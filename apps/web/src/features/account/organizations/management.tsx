import { useCallback, useEffect, useState } from "react";
import { endpoints, IdSchema } from "@quire/contracts";
import type { Organization, ResponseOf } from "@quire/contracts";
import { Button, Field, Modal } from "../../../ui";
import { mutationHeaders, Notice, unwrap, useAction, value } from "../shared";
import type { SettingsProps } from "../settings";
import { ManagedLifecycle } from "./lifecycle";

type Member = ResponseOf<typeof endpoints.organizationManagementList>["items"][number];
type Props = SettingsProps & { readonly organization: Organization; readonly refreshOrganization: () => Promise<void>;
  readonly canAuthorizeLifecycle: boolean };

export function OrganizationManagement(props: Props) {
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<{ readonly action: "release" | "delete"; readonly member: Member } | null>(null);
  const action = useAction();
  const load = useCallback(async (signal?: AbortSignal) => {
    const items: Member[] = [];
    let cursor: string | undefined;
    do {
      const page = unwrap(await props.client.call(endpoints.organizationManagementList, {
        params: { o: props.organization.id }, query: { limit: 200, ...(cursor ? { cursor } : {}) }, body: undefined,
      }, signal));
      items.push(...page.items); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    setMembers(items);
  }, [props.client, props.organization.id]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (!(cause instanceof Error)) throw cause;
      action.setError(cause.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, props.organization.version, action.setError]);
  const recipients = members.filter(member => member.canReceiveProjects && member.id !== selection?.member.id);
  return <section className="account-stack" aria-labelledby="organization-management-title">
    <h3 id="organization-management-title">Managed accounts</h3>
    <p>Membership is separate from account management. Each member must explicitly accept management in Sign-in &amp; SSO settings.</p>
    <p>Sensitive actions require a recent sign-in. <a href={`/sign-in?returnTo=${encodeURIComponent(props.path)}`}>Sign in again</a>.</p>
    <Notice {...action} />
    {loading && <p role="status">Loading managed accounts...</p>}
    {!loading && members.length === 0 && !action.error && <p>No current members are available.</p>}
    <div className="account-stack">{members.map(member => <div className="organization-member account-stack" key={member.id} role="group" aria-label={`Management for ${member.email}`}>
      <h4>{member.name}</h4><p>{member.email}</p>
      <p>Management status: {member.management?.state.replaceAll("_", " ") ?? "Not managed"}</p>
      <div className="account-actions">
        {member.canInvite && <Button busy={action.busy} onClick={() => void action.run(async () => {
          unwrap(await props.client.call(endpoints.managedInvite, { params: { o: props.organization.id }, query: {},
            body: { userId: member.id, expectedVersion: props.organization.version }, headers: mutationHeaders() }));
          await load(); action.setMessage("Management invitation queued. The member must accept.");
        })}>Invite to management</Button>}
        {member.canRelease && <Button busy={action.busy} onClick={() => setSelection({ action: "release", member })}>Release account</Button>}
        {member.canDelete && <Button variant="danger" busy={action.busy} onClick={() => setSelection({ action: "delete", member })}>Delete managed account</Button>}
      </div>
    </div>)}</div>
    <Button busy={action.busy} onClick={() => void action.run(async () => {
      await props.refreshOrganization(); await load(); setLoading(false);
    })}>Refresh managed accounts</Button>
    {!loading && <ManagedLifecycle {...props} members={members} canAuthorize={props.canAuthorizeLifecycle} refreshManaged={load} />}
    <Modal open={selection !== null} onClose={() => { if (!action.busy) setSelection(null); }}
      title={selection?.action === "delete" ? "Delete managed account" : "Release account"}>
      {selection && <form className="account-form" onKeyDown={event => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }} onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        if (value(form, "confirmation").toLowerCase() !== selection.member.email.toLowerCase()) {
          action.setError("Enter the member's email to confirm."); return;
        }
        void action.run(async () => {
          const input = { params: { o: props.organization.id, u: selection.member.id }, query: {},
            headers: mutationHeaders() };
          if (selection.action === "release") {
            unwrap(await props.client.call(endpoints.managedRelease, { ...input, body: { expectedVersion: selection.member.userVersion } }));
          } else {
            const transferTo = IdSchema.parse(value(form, "transferTo"));
            unwrap(await props.client.call(endpoints.managedDelete, { ...input, body: { transferTo, expectedVersion: selection.member.userVersion } }));
          }
          setSelection(null);
          if (selection.member.id === props.account.user.id) {
            await props.onSessionChange(); props.navigate("/sign-in"); return;
          }
          await props.refreshOrganization(); await load();
          action.setMessage(selection.action === "release" ? "Account released." : "Managed account deleted and projects reassigned.");
        });
      }}>
        <p>{selection.member.name} ({selection.member.email})</p>
        {selection.action === "release" ? <p>Release ends this team's membership and account control, preserves owned projects, and requires usable independent sign-in. Existing sessions will end.</p>
          : <><p>Delete this managed account only after transferring its projects to another active, accepted managed member of this team.</p>
            {recipients.length === 0 ? <p>No eligible managed recipient is available.</p> : <label className="q-field">
              <span className="q-field__label">Transfer projects to</span>
              <select className="q-input" name="transferTo" defaultValue="" required>
                <option value="" disabled>Choose a managed recipient</option>
                {recipients.map(member => <option key={member.id} value={member.id}>{member.name} ({member.email})</option>)}
              </select>
            </label>}</>}
        <Field label="Confirmation email" name="confirmation" type="email" required autoComplete="off" />
        <Notice {...action} />
        <div className="account-actions">
          <Button disabled={action.busy} onClick={() => setSelection(null)}>Cancel</Button>
          <Button type="submit" variant={selection.action === "delete" ? "danger" : "primary"} busy={action.busy}
            disabled={selection.action === "delete" && recipients.length === 0}
            onKeyDown={event => { if (event.key === "Enter") event.stopPropagation(); }}>
            {selection.action === "delete" ? "Delete and reassign" : "Confirm release"}
          </Button>
        </div>
      </form>}
    </Modal>
  </section>;
}
