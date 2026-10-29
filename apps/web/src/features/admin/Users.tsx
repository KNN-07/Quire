import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { AdminUserSummary } from "@quire/contracts";
import { Button, EmptyState, Field, RelativeTime, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { downloadBytes, errorMessage } from "./api";
import { InviteUser, ManageUser } from "./UserDialogs";

/** The main administration region owns scrolling; the table becomes cards on phones. */
export function Users({ client }: { readonly client: AdminClient }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [state, setState] = useState("active");
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [users, setUsers] = useState<readonly AdminUserSummary[]>([]);
  const [selected, setSelected] = useState<AdminUserSummary | null>(null);
  const [inviting, setInviting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const input = endpoints.adminUsersList.input.parse({
      params: {}, query: { q: query, role, state, cursor, limit: 50 },
    });
    void client.call(endpoints.adminUsersList, input, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if ("error" in result) {
        setError(result.error.message);
        setUsers([]);
      } else {
        setUsers(result.data.items);
        setNextCursor(result.data.nextCursor);
      }
      setLoading(false);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) { setError(errorMessage(failure)); setLoading(false); }
    });
    return () => controller.abort();
  }, [client, query, role, state, cursor, refresh]);
  function completed(message: string) {
    setSelected(null); setInviting(false); setNotice(message);
    setRefresh(value => value + 1);
  }
  async function exportUsers() {
    setExporting(true); setError("");
    try {
      const input = endpoints.adminUsersCsv.input.parse({ params: {}, query: { q: query, role, state } });
      const result = await client.call(endpoints.adminUsersCsv, input);
      if ("error" in result) setError(result.error.message);
      else downloadBytes(result.data, "quire-users.csv");
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setExporting(false); }
  }
  return <section aria-labelledby="admin-users-title">
    <div className="admin-row admin-page-heading">
      <h1 id="admin-users-title">Users &amp; groups</h1>
      <Button busy={exporting} onClick={() => void exportUsers()}>Export CSV</Button>
      <Button variant="primary" onClick={() => setInviting(true)}>Invite users</Button>
    </div>
    <div className="admin-user-filters">
      <Field label="Search users" aria-label="Search by name or email" placeholder="Search by name or email"
        value={query} onChange={event => { setQuery(event.currentTarget.value); setCursor(undefined); }} />
      <label className="admin-label"><span className="q-sr-only">Filter by role</span>
        <select aria-label="Filter by role" value={role} onChange={event => { setRole(event.currentTarget.value); setCursor(undefined); }}>
          <option value="all">All roles</option><option value="operator">Operators</option>
          <option value="member">Members</option><option value="guest">Guests</option>
        </select>
      </label>
      <label className="admin-label"><span className="q-sr-only">Filter by status</span>
        <select aria-label="Filter by status" value={state} onChange={event => { setState(event.currentTarget.value); setCursor(undefined); }}>
          <option value="active">Active users</option><option value="suspended">Suspended</option>
          <option value="deleted">Deleted</option><option value="all">All statuses</option>
        </select>
      </label>
    </div>
    {notice && <p role="status">{notice}</p>}
    {error ? <div role="alert" className="admin-message"><p>{error}</p>
      <Button onClick={() => setRefresh(value => value + 1)}>Retry</Button></div>
      : loading ? <Spinner label="Loading users" />
        : users.length === 0 ? <EmptyState icon="users" title="No users found" description="Try another search or invite someone to this instance." />
          : <div className="admin-user-table"><table className="admin-table">
            <thead><tr><th>Name</th><th>Role</th><th>Groups</th><th>Projects</th><th>Last active</th><th><span className="q-sr-only">Actions</span></th></tr></thead>
            <tbody>{users.map(user => <tr key={user.id}>
              <td data-label="Name"><strong>{user.name}</strong><small>{user.primaryEmail}</small>
                {(user.suspended || user.deletedAt) && <small>{user.deletedAt ? "Deleted" : "Suspended"}</small>}</td>
              <td data-label="Role">{user.operator ? "Operator" : user.groups.length ? "Member" : "Guest"}</td>
              <td data-label="Groups">{user.groups.length ? user.groups.map(group => group.name).join(", ") : "No groups"}</td>
              <td data-label="Projects">{user.projectCount}</td>
              <td data-label="Last active">{user.lastSeenAt ? <RelativeTime value={user.lastSeenAt} /> : "Not yet"}</td>
              <td data-label="Actions"><Button size="small" onClick={() => setSelected(user)}>Manage<span className="q-sr-only"> {user.name}</span></Button></td>
            </tr>)}</tbody>
          </table></div>}
    <div className="admin-row admin-user-footer"><p>{users.length} users on this page</p>
      {cursor && <Button onClick={() => setCursor(undefined)}>First page</Button>}
      {nextCursor && !loading && <Button onClick={() => setCursor(nextCursor)}>Next page</Button>}
    </div>
    {inviting && <InviteUser client={client} onClose={() => setInviting(false)} onComplete={completed} />}
    {selected && <ManageUser key={`${selected.id}-${selected.version}`} client={client} user={selected}
      onClose={() => setSelected(null)} onComplete={completed} />}
  </section>;
}
