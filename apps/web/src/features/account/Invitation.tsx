import { useEffect, useState } from "react";
import { endpoints, IdSchema } from "@quire/contracts";
import type { ResponseOf } from "@quire/contracts";
import { BrandMark, Button, Spinner } from "../../ui";
import { mutationHeaders, Notice, unwrap, useAction } from "./shared";
import type { AccountPageProps } from "./shared";

export function Invitation(props: AccountPageProps & { readonly kind?: "project" | "organization" }) {
  const kind = props.kind ?? "project";
  const url = new URL(props.path, location.origin);
  const rawId = url.pathname.split("/")[2] ?? "";
  const token = url.searchParams.get("token");
  const [preview, setPreview] = useState<{ readonly invitation: ResponseOf<typeof endpoints.invitationGet>["invitation"]; readonly name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [signIn, setSignIn] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const action = useAction();
  const signInPath = `/sign-in?returnTo=${encodeURIComponent(url.pathname + url.search)}`;
  useEffect(() => {
    const id = IdSchema.safeParse(rawId);
    setPreview(null); setError(""); setSignIn(false); setAccepted(false);
    if (!id.success) { setError("This invitation link is invalid."); setLoading(false); return undefined; }
    const controller = new AbortController();
    setLoading(true);
    const input = { params: { id: id.data }, query: {}, body: undefined };
    const response = kind === "organization"
      ? props.client.call(endpoints.organizationInvitationGet, input, controller.signal)
      : props.client.call(endpoints.invitationGet, input, controller.signal);
    void response.then(result => {
      if (controller.signal.aborted) return;
      if ("error" in result) {
        if (result.error.code === "UNAUTHENTICATED") setSignIn(true);
        else setError(result.error.message);
      } else setPreview({ invitation: result.data.invitation, name: "organizationName" in result.data ? result.data.organizationName : result.data.projectName });
      setLoading(false);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      if (!(failure instanceof Error)) throw failure;
      setError(failure.message); setLoading(false);
    });
    return () => controller.abort();
  }, [props.client, rawId, token, kind]);
  const invitation = preview?.invitation;
  return <main className="account-reset">
    <a href="/" aria-label="Quire home"><BrandMark /></a>
    <section className="account-reset__card account-stack" aria-labelledby="invitation-title">
      <h1 id="invitation-title">{accepted ? "Invitation accepted" : kind === "organization" ? "Organization invitation" : "Project invitation"}</h1>
      {loading ? <Spinner label="Loading invitation" /> : signIn ? <>
        <p>Sign in with the verified email address that received this invitation.</p>
        <Button variant="primary" onClick={() => props.navigate(signInPath)}>Sign in to continue</Button>
      </> : preview && invitation ? <>
        <h2>{preview.name}</h2>
        <p>Invited email: {invitation.email}</p><p>Requested access: {invitation.role}</p>
        {accepted ? <Button variant="primary" onClick={() => props.navigate(kind === "organization" ? "/settings/organizations" : `/projects/${invitation.projectId}/edit`)}>{kind === "organization" ? "Open organizations" : "Open project"}</Button>
          : invitation.status !== "pending" ? <p>This invitation is {invitation.status}. Ask the owner for a new invitation if you still need access.</p>
          : !token ? <p>The invitation token is missing. Open the complete link from your invitation email.</p>
          : <>
            <p>Expires <time dateTime={invitation.expiresAt}>{new Date(invitation.expiresAt).toLocaleString()}</time>.</p>
            <p>Accepting adds this account to the {kind}. Opening this page grants no access.</p>
            {kind === "organization" && <p>Membership does not assign a licensed seat. An organization administrator can assign one separately after acceptance.</p>}
            <Button variant="primary" busy={action.busy} onClick={() => void action.run(async () => {
              const input = { params: { id: invitation.id }, query: {},
                body: { token, expectedVersion: invitation.version }, headers: mutationHeaders() };
              if (kind === "organization") unwrap(await props.client.call(endpoints.organizationInvitationAccept, input));
              else unwrap(await props.client.call(endpoints.invitationAccept, input));
              await props.onSessionChange();
              setAccepted(true);
            })}>Accept invitation</Button>
          </>}
      </> : error && <><Notice error={error} message="" /><Button onClick={() => props.navigate(signInPath)}>Sign in with another account</Button></>}
      <Notice {...action} />
      <a href="/projects">Back to projects</a>
    </section>
  </main>;
}
