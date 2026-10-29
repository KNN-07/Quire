import { useState } from "react";
import { endpoints, UserSchema } from "@quire/contracts";
import { Button, Field } from "../../ui";
import { mutationHeaders, Notice, Panel, SaveBar, Select, unwrap, useAction, value } from "./shared";
import type { SettingsProps } from "./settings";

const initials = (name: string) => name.trim().split(/\s+/u).slice(0, 2)
  .map(part => Array.from(part)[0] ?? "").join("").toLocaleUpperCase();
export function Profile(props: SettingsProps) {
  const { user } = props.account;
  const action = useAction();
  const [generation, setGeneration] = useState(0);
  const [avatarError, setAvatarError] = useState("");
  const [photoName, setPhotoName] = useState("");
  const version = props.userVersion;
  return <Panel title="Profile">
    <p className="account-muted">Shown to collaborators and on author lines you insert.</p>
    {avatarError && <Notice error={avatarError} message="" />}
    <form className="account-photo" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run(async () => {
        if (version === null) { action.setError("The server did not return an account version. Reload before saving."); return; }
        const file = form.get("photo");
        if (!(file instanceof File) || file.size === 0) { action.setError("Choose a photo first."); return; }
        const upload = new FormData(); upload.set("file", file); upload.set("expectedVersion", String(version));
        unwrap(await props.client.call(endpoints.avatarPut, { params: {}, query: {}, body: upload, headers: { "if-match": `"v${version}"` } }));
        await props.refresh(); setPhotoName(""); action.setMessage("Profile photo uploaded.");
      });
    }}>
      {user.avatarBlob ? <img key={`${user.avatarBlob}:${version}`} className="account-avatar" width={72} height={72} alt="Profile photo" src={props.client.url(endpoints.avatarGet, { params: {}, query: {}, body: undefined }).href} onLoad={() => setAvatarError("")} onError={() => setAvatarError("The stored profile photo could not be loaded.")} /> : <span className="account-avatar" aria-label="No profile photo">{initials(user.name)}</span>}
      <div className="account-photo__controls">
        <span className="account-muted">{photoName ? `Selected: ${photoName}` : user.avatarBlob ? "Your saved profile photo" : "No profile photo uploaded."}</span>
        <div className="account-row">
          <label className="q-button q-button--neutral q-button--regular account-file">
            <input className="q-sr-only" aria-label="Profile photo" name="photo" type="file" accept="image/*" required onChange={event => setPhotoName(event.currentTarget.files?.[0]?.name ?? "")} />Choose photo…</label>
          <Button type="submit" variant={photoName ? "primary" : "neutral"} disabled={version === null} busy={action.busy}>Upload photo</Button>
          <Button variant="ghost" disabled={!user.avatarBlob || version === null} onClick={() => { void action.run(async () => {
            if (version === null) return;
            unwrap(await props.client.call(endpoints.avatarDelete, { params: {}, query: {}, body: { expectedVersion: version } }));
            await props.refresh(); action.setMessage("Profile photo removed.");
          }); }}>Remove photo</Button>
        </div>
      </div>
    </form>
    <form key={generation + ":" + version} className="account-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run(async () => {
        if (version === null) { action.setError("Missing account version. Reload before saving."); return; }
        unwrap(await props.client.call(endpoints.profilePatch, { params: {}, query: {}, body: {
          name: value(form, "name"), latexName: value(form, "latexName"), affiliation: value(form, "affiliation"),
          orcid: value(form, "orcid") || null, interfaceLanguage: UserSchema.unwrap().shape.interfaceLanguage.parse(value(form, "language")), expectedVersion: version,
        } }));
        await props.refresh(); await props.onSessionChange(); action.setMessage("Profile saved.");
      });
    }}>
      <fieldset disabled={action.busy || version === null}>
        <div className="account-fields">
          <Field label="Full name" name="name" required defaultValue={user.name} autoComplete="name" />
          <Field label="Name in LaTeX" name="latexName" defaultValue={user.latexName} />
          <Field label="Email" value={user.primaryEmail} readOnly hint={user.managedBy ? "Managed by your organization" : "Primary account email"} />
          <Field label="Affiliation" name="affiliation" defaultValue={user.affiliation} autoComplete="organization" />
          <Field label="ORCID iD" name="orcid" defaultValue={user.orcid ?? ""} placeholder="0000-0000-0000-0000" />
          <Select label="Interface language" name="language" defaultValue={user.interfaceLanguage} options={[["en", "English"], ["vi", "Tiếng Việt"], ["zh", "中文"]]} />
        </div>
        <SaveBar busy={action.busy} cancel={() => setGeneration(generation + 1)} />
      </fieldset>
    </form>
    {version === null && <p role="alert">The server did not return an account version. Profile mutations are disabled.</p>}
    <Notice {...action} />
    {action.error && <Button onClick={() => { void action.run(async () => { await props.refresh(); action.setMessage("Latest profile loaded. Review your changes before saving again."); }); }}>Reload current profile</Button>}
    <h3 className="account-subheading">Verified emails</h3><ul className="account-list">{user.verifiedEmails.map(email => <li key={email}><div className="account-row"><span>{email}</span>{email !== user.primaryEmail && <Button disabled={version === null} busy={action.busy} onClick={() => { void action.run(async () => {
      if (version === null) return;
      unwrap(await props.client.call(endpoints.emailDelete, { params: {}, query: {}, body: { email, expectedVersion: version } }));
      await props.refresh(); action.setMessage("Email removed.");
    }); }}>Remove {email}</Button>}</div></li>)}</ul>
    <form className="account-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run(async () => {
        if (version === null) return;
        unwrap(await props.client.call(endpoints.emailAdd, { params: {}, query: {}, body: { email: value(form, "email"), expectedVersion: version }, headers: mutationHeaders() }));
        await props.refresh(); action.setMessage("Email verification requested. Check the address you added.");
      });
    }} data-inline=""><Field label="Additional email" name="email" type="email" required /><Button type="submit" disabled={version === null} busy={action.busy}>Add email</Button></form>
  </Panel>;
}
