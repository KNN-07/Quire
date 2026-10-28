import { endpoints } from "@quire/contracts";
import type { ResponseOf } from "@quire/contracts";
import { Button } from "../../../ui";
import { editorValue } from "../shared";
import type { ReviewPanelProps } from "../shared";
import { initials, reviewRoles } from "./common";

type Access = ResponseOf<typeof endpoints.accessGet>;
type Mutate = (key: string, action: () => Promise<void>, message: string) => Promise<void>;

export function ShareAccessLists({ props, access, busy, mutate, onTransfer }: {
  readonly props: ReviewPanelProps;
  readonly access: Access;
  readonly busy: string | null;
  readonly mutate: Mutate;
  readonly onTransfer: (user: Access["members"][number]["user"]) => void;
}) {
  const { client, workspace } = props;
  return <>
    <div className="quire-share__group">
      <h3>People with access</h3>
      <ul className="quire-review__list">
        {access.members.map(member => <li key={member.user.id} className="quire-share__person"
          data-member-id={member.user.id} data-current-role={member.role}>
          <span className="quire-review__avatar" aria-hidden="true">{initials(member.user.name)}</span>
          <span className="quire-share__identity"><strong>{member.user.name}</strong>
            <span>{member.user.primaryEmail}</span>
            <span>Effective: {member.effectiveRole}{member.capacityLimited ? " (read-only: writable capacity)" : ""}</span></span>
          {member.role === "owner" ? <span>Owner</span> : <>
            <label className="quire-review__compact-label">Assigned role<select value={member.role}
              disabled={busy !== null}
              onChange={event => {
                const role = event.currentTarget.value;
                if (role !== "editor" && role !== "reviewer" && role !== "viewer") return;
                void mutate(`member-${member.user.id}`, async () => {
                  editorValue(await client.call(endpoints.accessMemberPatch, {
                    params: { p: workspace.scope.projectId, id: member.user.id }, query: {},
                    body: { role, expectedVersion: member.version }, headers: workspace.requestHeaders,
                  }));
                }, `${member.user.name} is now a ${role}.`);
              }}>{reviewRoles.map(role => <option value={role} key={role}>{role}</option>)}</select></label>
            <Button size="small" variant="ghost" onClick={() => onTransfer(member.user)}>Transfer ownership</Button>
            <Button size="small" variant="danger" busy={busy === `remove-${member.user.id}`}
              onClick={() => void mutate(`remove-${member.user.id}`, async () => {
                editorValue(await client.call(endpoints.accessMemberDelete, {
                  params: { p: workspace.scope.projectId, id: member.user.id }, query: {},
                  body: { expectedVersion: member.version }, headers: workspace.requestHeaders,
                }));
              }, `${member.user.name} no longer has access.`)}>Remove</Button>
          </>}
        </li>)}
      </ul>
    </div>

    {access.invitations.length > 0 && <div className="quire-share__group"><h3>Pending invitations</h3>
      <ul className="quire-review__list">{access.invitations.map(invitation =>
        <li key={invitation.id} className="quire-share__person"><span className="quire-review__avatar" aria-hidden="true">@</span>
          <span className="quire-share__identity"><strong>{invitation.email}</strong><span>{invitation.role} · {invitation.status}</span></span>
          <Button size="small" variant="ghost" onClick={() => void mutate(`resend-${invitation.id}`, async () => {
            editorValue(await client.call(endpoints.invitationResend, {
              params: { p: workspace.scope.projectId, id: invitation.id }, query: {},
              body: { expectedVersion: invitation.version }, headers: workspace.requestHeaders,
            }));
          }, `Invitation resent to ${invitation.email}.`)}>Resend</Button>
          <Button size="small" variant="danger" onClick={() => void mutate(`revoke-${invitation.id}`, async () => {
            editorValue(await client.call(endpoints.invitationDelete, {
              params: { p: workspace.scope.projectId, id: invitation.id }, query: {},
              body: { expectedVersion: invitation.version }, headers: workspace.requestHeaders,
            }));
          }, `Invitation to ${invitation.email} revoked.`)}>Revoke</Button></li>)}</ul></div>}

    {access.requests.some(request => request.status === "pending") && <div className="quire-share__group">
      <h3>Access requests (<span role="status" aria-label="Pending access requests">{access.requests.filter(request => request.status === "pending").length}</span>)</h3><ul className="quire-review__list">
        {access.requests.filter(request => request.status === "pending").map(request =>
          <li key={request.id} className="quire-share__request">
            <div><strong>{request.role} requested</strong><p>{request.message}</p></div>
            <Button size="small" onClick={() => void mutate(`decline-${request.id}`, async () => {
              editorValue(await client.call(endpoints.accessDecide, {
                params: { p: workspace.scope.projectId, id: request.id }, query: {},
                body: { accept: false, expectedVersion: request.version },
                headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
              }));
            }, "Access request declined.")}>Decline</Button>
            <Button size="small" variant="primary" onClick={() => void mutate(`accept-${request.id}`, async () => {
              editorValue(await client.call(endpoints.accessDecide, {
                params: { p: workspace.scope.projectId, id: request.id }, query: {},
                body: { accept: true, expectedVersion: request.version },
                headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
              }));
            }, "Access request accepted.")}>Accept</Button>
          </li>)}
      </ul></div>}
  </>;
}
