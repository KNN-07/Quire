import { endpoints } from "@quire/contracts";
import { Button, Field } from "../../ui";
import { Notice, unwrap, useAction, value } from "./shared";
import type { AccountPageProps } from "./shared";

export function LdapSignIn({ client, onSessionChange, navigate, returnTo, onBack }: Pick<AccountPageProps, "client" | "onSessionChange" | "navigate"> & {
  readonly returnTo: string;
  readonly onBack: () => void;
}) {
  const action = useAction();
  return <section className="account-stack" aria-label="Institutional directory sign-in">
    <Button onClick={onBack} disabled={action.busy}>Back</Button>
    <h2>Sign in with your directory</h2>
    <form className="account-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run(async () => {
        const destination = new URL(returnTo, location.origin);
        // LDAP validates a projects/settings continuation but returns JSON, not a redirect.
        const continuation = ["/projects", "/settings"].some(path => destination.pathname === path || destination.pathname.startsWith(`${path}/`))
          ? destination.pathname + destination.search : "/projects";
        unwrap(await client.call(endpoints.ldapLogin, { params: {}, query: {}, body: {
          username: value(form, "username"), password: value(form, "password"), returnTo: continuation,
        } }));
        await onSessionChange(); navigate(returnTo);
      });
    }}>
      <fieldset disabled={action.busy}>
        <Field label="Directory username" name="username" required autoComplete="username" />
        <Field label="Directory password" name="password" type="password" required autoComplete="current-password" />
        <Notice {...action} />
        <Button type="submit" variant="dark" busy={action.busy} className="account-submit">Sign in with directory</Button>
      </fieldset>
    </form>
  </section>;
}
