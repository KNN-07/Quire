import { useCallback, useEffect, useState } from "react";
import type { ResponseOf } from "@quire/contracts";
import { endpoints } from "@quire/contracts";
import { Button } from "../../../ui";
import { mutationHeaders, Notice, unwrap, useAction } from "../shared";
import type { SettingsProps } from "../settings";

type Links = ResponseOf<typeof endpoints.samlLinks>;
export function OrganizationSaml({ client, organizationId }: Pick<SettingsProps, "client"> & { readonly organizationId: string }) {
  const [links, setLinks] = useState<Links | null>(null);
  const action = useAction();
  const load = useCallback(async (signal?: AbortSignal) => {
    setLinks(unwrap(await client.call(endpoints.samlLinks,
      { params: { o: organizationId }, query: {}, body: undefined }, signal)));
  }, [client, organizationId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted && error instanceof Error) action.setError(error.message);
    });
    return () => controller.abort();
  }, [load, action.setError]);
  async function perform(command: "remind" | "unlink" | "unlink-all", userId?: string) {
    if (!links) return;
    if (command !== "remind" && !window.confirm(command === "unlink-all" ?
      "Unlink all proven SAML identities in this organization? Use this after the unique identifier changes. All affected sessions will end." :
      "Unlink this member's SAML identities and end all their sessions?")) return;
    await action.run(async () => {
      const result = unwrap(await client.call(endpoints.samlLinksAction, {
        params: { o: organizationId }, query: {}, headers: mutationHeaders(),
        body: { action: command, ...(userId ? { userId } : {}), expectedVersion: links.version, snapshot: links.snapshot },
      }));
      if (result.signedOut) { location.assign("/sign-in"); return; }
      await load();
      action.setMessage(result.queued ? "Reminder queued in the local outbox. External delivery is not claimed." :
        `${result.affected} account(s) unlinked. Their sessions ended; accounts and projects remain.`);
    });
  }
  return <section className="account-stack" aria-label="Organization SAML links">
    <h3>SAML links</h3>
    <Notice {...action} />
    <Button busy={action.busy} onClick={() => void action.run(() => load())}>Refresh SAML links</Button>
    {!links ? <p role="status">Loading SAML link status...</p> : !links.configured ?
      <p>This organization has no configured SAML adapter.</p> : <>
        <p>Reminders ask members to sign in and explicitly link their existing account. Unlinking preserves accounts, projects and independent identities. Every affected session ends.</p>
        <p>Unlink all is for a change to the IdP unique identifier. Each affected member needs an independently usable password and verified email. Accepted managed accounts receive one administrator-authorized SAML relink while management remains in place.</p>
        <Button variant="danger" busy={action.busy}
          disabled={!links.items.some(item => item.linked) || links.items.some(item => item.linked && item.unlinkBlocked)}
          onClick={() => void perform("unlink-all")}>Unlink all SAML users</Button>
        {links.items.map(item => <div className="organization-member account-stack" key={item.userId} aria-label={`SAML member ${item.email}`}>
          <p><strong>{item.name}</strong> / {item.email}</p>
          <p>{item.linked ? "Linked" : item.unproven ? "Identity ownership needs verification" : "Not linked"}</p>
          {item.unproven && <p>Existing identity provenance cannot be assumed. Complete a verified SAML login before administration.</p>}
          {item.linked && item.unlinkBlocked && <p>{item.unlinkBlocked}</p>}
          <div className="account-actions">
            <Button busy={action.busy} disabled={item.linked || item.unproven} onClick={() => void perform("remind", item.userId)}>Remind member</Button>
            <Button variant="danger" busy={action.busy} disabled={!item.linked || Boolean(item.unlinkBlocked)}
              onClick={() => void perform("unlink", item.userId)}>Unlink member</Button>
          </div>
        </div>)}
      </>}
  </section>;
}
