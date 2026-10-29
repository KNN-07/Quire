import { useCallback, useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { ResponseOf } from "@quire/contracts";
import { Button } from "../../ui";
import { mutationHeaders, Notice, unwrap, useAction } from "./shared";
import type { SettingsProps } from "./settings";

type Management = ResponseOf<typeof endpoints.managementList>["items"][number];

export function AccountManagement(props: SettingsProps) {
  const [records, setRecords] = useState<readonly Management[]>([]);
  const [loading, setLoading] = useState(true);
  const action = useAction();
  const load = useCallback(async (signal?: AbortSignal) => {
    const items: Management[] = [];
    let cursor: string | undefined;
    do {
      const page = unwrap(await props.client.call(endpoints.managementList, {
        params: {}, query: { limit: 200, ...(cursor ? { cursor } : {}) }, body: undefined,
      }, signal));
      items.push(...page.items); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    setRecords(items);
  }, [props.client]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (!(cause instanceof Error)) throw cause;
      action.setError(cause.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, action.setError]);
  return <section className="account-stack" aria-labelledby="account-management-title">
    <h3 id="account-management-title">Account management</h3>
    <Notice {...action} />
    {loading ? <p role="status">Loading management status...</p> : records.length === 0 && !action.error
      ? <p>No organization management invitations or accepted management.</p> : null}
    <ul className="account-list">{records.map(record => <li key={`${record.id}:${record.version}`} className="account-stack">
      <h4>{record.organizationName}</h4>
      <p>Management status: {record.state.replaceAll("_", " ")}</p>
      {record.canAccept && <form className="account-form" aria-label={`Accept management by ${record.organizationName}`} onSubmit={event => {
        event.preventDefault();
        if (!new FormData(event.currentTarget).has("consent")) return;
        void action.run(async () => {
          unwrap(await props.client.call(endpoints.managedAccept, { params: { id: record.id }, query: {},
            body: { expectedVersion: record.version }, headers: mutationHeaders() }));
          await props.refresh(); await props.onSessionChange(); await load();
          action.setMessage("Account management accepted.");
        });
      }}>
        <p>Acceptance lets this organization manage your account, restrict account changes, and reassign your projects when deleting the managed account. Membership alone does not give it this control.</p>
        <label className="account-check"><span>Allow this organization to manage my account</span><input type="checkbox" name="consent" required /></label>
        <Button type="submit" busy={action.busy}>Accept management</Button>
      </form>}
    </li>)}</ul>
    <Button busy={action.busy} onClick={() => void action.run(async () => {
      await load(); await props.refresh(); setLoading(false);
    })}>Refresh management status</Button>
  </section>;
}
