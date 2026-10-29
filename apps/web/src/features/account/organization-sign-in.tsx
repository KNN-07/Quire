import { useState } from "react";
import type { z } from "zod";
import { endpoints } from "@quire/contracts";
import type { createClient } from "@quire/contracts";
import { Button, Field } from "../../ui";
import { Notice, unwrap, useAction, value } from "./shared";

type Discovery = z.infer<typeof endpoints.authDiscover.output>;

export function OrganizationSignIn({ client, onBack, onSelect }: {
  readonly client: ReturnType<typeof createClient>;
  readonly onBack: () => void;
  readonly onSelect: (provider: "oidc" | "saml" | "ldap") => void;
}) {
  const [result, setResult] = useState<Discovery | null>(null);
  const action = useAction();
  return <section className="account-stack" aria-label="Organization sign-in">
    <Button onClick={onBack} disabled={action.busy}>Back</Button>
    <h2>Find your organization</h2>
    <form className="account-form" onSubmit={event => {
      event.preventDefault();
      const domain = value(new FormData(event.currentTarget), "domain");
      setResult(null);
      void action.run(async () => {
        setResult(unwrap(await client.call(endpoints.authDiscover, {
          params: {}, query: { domain }, body: undefined,
        })));
      });
    }}>
      <fieldset disabled={action.busy}>
        <Field label="Organization email domain" name="domain" required
          placeholder="university.edu" autoCapitalize="none" autoCorrect="off"
          onChange={() => { setResult(null); action.setError(""); }} />
        <p className="account-muted">Enter the domain after @ in your organization email address.</p>
        <Notice {...action} />
        <Button type="submit" variant="dark" busy={action.busy}>Find organization</Button>
      </fieldset>
    </form>
    {result?.organizations.length === 0 && <p role="status">No organization sign-in is configured for this domain. Check the domain or go back to another sign-in method.</p>}
    {result?.organizations.map(organization => <div className="account-stack" key={organization.id}>
      <Button disabled={!organization.capability.enabled} onClick={() => onSelect(organization.provider)}>
        Continue with {organization.name}
      </Button>
      {!organization.capability.enabled && <p className="account-muted">
        {organization.capability.reason ?? organization.capability.state}
      </p>}
    </div>)}
  </section>;
}
