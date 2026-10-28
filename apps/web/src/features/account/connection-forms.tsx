import { endpoints } from "@quire/contracts";
import type { AccountPageProps } from "./shared";
import { Button, Field } from "../../ui";
import { Notice, unwrap, useAction, value } from "./shared";

export type CredentialProvider = "zotero" | "git";
export function ConnectionForm(props: {
  readonly client: AccountPageProps["client"];
  readonly provider: CredentialProvider;
  readonly saved: () => Promise<void>;
  readonly cancel: () => void;
}) {
  const action = useAction();
  const generic = props.provider === "git";
  return <form className="account-form connection-form" autoComplete="off" aria-label={generic ? "Generic Git credentials" : "Zotero credentials"} onSubmit={event => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    void action.run(async () => {
      const label = value(form, "label");
      if (generic) {
        unwrap(await props.client.call(endpoints.gitCredentials, { params: {}, query: {}, body: {
          label, url: value(form, "url"), username: value(form, "username"), secret: value(form, "secret"),
        } }));
      } else {
        unwrap(await props.client.call(endpoints.connectionCredentials, { params: { provider: "zotero" }, query: {}, body: {
          label, accessToken: value(form, "accessToken"),
        } }));
      }
      // Clear submitted secrets before refreshing any other data.
      element.reset();
      await props.saved();
      action.setMessage("Connection saved. The submitted credential has been cleared.");
    });
  }}>
    <h3>{generic ? "Generic Git repository" : "Zotero API key"}</h3>
    <p className="account-muted">{generic
      ? "Credentials are verified against this repository and cannot be used for another URL."
      : "Use a dedicated key with library read access. Stored keys are never displayed."}</p>
    <fieldset disabled={action.busy}>
      <Field label="Connection label" name="label" required maxLength={200} autoComplete="off" />
      {generic ? <>
        <Field label="Repository URL" name="url" type="url" required autoComplete="off" placeholder="https://git.example.org/team/paper.git" />
        <Field label="Repository username" name="username" required maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <Field label="Repository secret" name="secret" type="password" required maxLength={4096} autoComplete="new-password" autoCapitalize="none" spellCheck={false} />
      </> : <Field label="Zotero access token" name="accessToken" type="password" required maxLength={512} autoComplete="new-password" autoCapitalize="none" spellCheck={false} />}
    </fieldset>
    <div className="account-row">
      <Button disabled={action.busy} onClick={props.cancel}>Cancel connection</Button>
      <Button type="submit" disabled={action.busy}>{action.busy ? "Verifying credential..." : "Save connection"}</Button>
    </div>
    <Notice {...action} />
  </form>;
}
