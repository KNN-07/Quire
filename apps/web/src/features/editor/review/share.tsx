import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { ResponseOf, Role } from "@quire/contracts";
import { Button, EmptyState, Field, Modal, Spinner } from "../../../ui";
import { editorValue } from "../shared";
import type { ReviewPanelProps } from "../shared";
import { errorMessage, PanelMessage, reviewRoles } from "./common";
import { subscribeProjectEvents } from "./events";
import { ShareAccessLists } from "./share-access";
import { CurrentBenefits, WritableMembers } from "./WritableMembers";

type Access = ResponseOf<typeof endpoints.accessGet>;
type AccessState = {
  readonly data: Access;
  readonly version: number;
  readonly etag: string;
};
type LinkRole = Access["link"]["role"];

export function SharePanel(props: ReviewPanelProps) {
  const { client, workspace, refreshWorkspace } = props;
  const [access, setAccess] = useState<AccessState | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<Role, "owner">>("editor");
  const [requestRole, setRequestRole] = useState<"reviewer" | "editor">("reviewer");
  const requestedRole = workspace.access.role === "reviewer" ? "editor" : requestRole;
  const [requestMessage, setRequestMessage] = useState("");
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const accessRead = useRef(0);
  const [transferUser, setTransferUser] = useState<Access["members"][number]["user"] | null>(null);

  const load = useCallback(async () => {
    if (!workspace.access.capabilities.manageAccess) return;
    const read = ++accessRead.current;
    setError(null);
    const response = await client.callWithMetadata(endpoints.accessGet, {
      params: { p: workspace.scope.projectId }, query: { branch: workspace.scope.branch },
      body: undefined, headers: workspace.requestHeaders,
    });
    if (read !== accessRead.current) return;
    const version = response.metadata.expectedVersion;
    const etag = response.metadata.etag;
    if (version === null || etag === null) throw new TypeError("Access response omitted its project version");
    setAccess({ data: editorValue(response.result), version, etag });
  }, [client, workspace]);

  const refreshAuthority = useEffectEvent(() => {
    void Promise.all([load(), refreshWorkspace()]).catch(failure => setError(errorMessage(failure)));
  });
  useEffect(() => {
    const controller = new AbortController();
    if (workspace.access.capabilities.manageAccess) {
      void load().catch(failure => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    }
    const subscription = subscribeProjectEvents({
      client, workspace, topics: new Set(["access.changed", "policy.changed"]),
      onOpen: () => setLive(true),
      onEvent: () => refreshAuthority(),
    });
    void subscription.promise.catch(failure => {
      if (!controller.signal.aborted && failure instanceof Error && failure.name !== "AbortError") {
        setError(errorMessage(failure));
      }
    });
    return () => { controller.abort(); subscription.dispose(); };
  }, [client, workspace.scope.projectId, workspace.scope.branch, workspace.requestHeaders["x-project-token"]]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError(null); setSuccess(null);
    try { await action(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(null); }
  };

  const reload = async (message: string) => {
    setLinkUrl(null);
    await Promise.all([load(), refreshWorkspace()]);
    setSuccess(message);
  };

  if (!workspace.access.capabilities.manageAccess) {
    if (workspace.access.actorId === null) {
      return <EmptyState title="Sign in to request access"
        description="Anonymous link readers cannot request a named Reviewer or Editor role." />;
    }
    if (workspace.access.role === "editor") {
      return <section className="quire-review__section" aria-label="Project access">
        <h2>Project access</h2>
        <p>You already have Editor access. Only the owner can manage project sharing.</p>
        <CurrentBenefits workspace={workspace} />
      </section>;
    }
    return <section className="quire-review__section" aria-labelledby="access-request-title">
      <header className="quire-review__section-header">
        <div><h2 id="access-request-title">Request more access</h2>
          <p>Your current role is {workspace.access.role}. A request grants nothing until the owner accepts it.</p></div>
      </header>
      <CurrentBenefits workspace={workspace} />
      <form className="quire-review__form" onSubmit={event => {
        event.preventDefault();
        void run("request", async () => {
          editorValue(await client.call(endpoints.accessRequest, {
            params: { p: workspace.scope.projectId }, query: {},
            body: { role: requestedRole, message: requestMessage, expectedVersion: 0 },
            headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
          }));
          setRequestMessage(""); setSuccess("Access request sent.");
        });
      }}>
        <label>Requested role<select value={requestedRole}
          onChange={event => setRequestRole(event.currentTarget.value === "editor" ? "editor" : "reviewer")}>
          {workspace.access.role !== "reviewer" && <option value="reviewer">Reviewer</option>}<option value="editor">Editor</option>
        </select></label>
        <label>Message<textarea required value={requestMessage}
          onChange={event => setRequestMessage(event.currentTarget.value)}
          placeholder="Explain what you need to do in this project." /></label>
        <Button variant="primary" type="submit" busy={busy === "request"}>Send request</Button>
      </form>
      {error && <PanelMessage tone="error">{error}</PanelMessage>}
      {success && <PanelMessage tone="success">{success}</PanelMessage>}
    </section>;
  }

  if (!access) return <div className="quire-review__loading"><Spinner label="Loading sharing settings" />
    {error && <PanelMessage tone="error">{error}</PanelMessage>}</div>;

  const mutate = async (key: string, action: () => Promise<void>, message: string) =>
    run(key, async () => { await action(); await reload(message); });

  const setLink = async (role: LinkRole) => run(`link-${role}`, async () => {
    const result = editorValue(await client.call(endpoints.accessLinkPut, {
      params: { p: workspace.scope.projectId }, query: {},
      body: { role, expectedVersion: access.version },
      headers: {
        ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID(), "if-match": access.etag,
      },
    }));
    await Promise.all([load(), refreshWorkspace()]);
    setLinkUrl(result.urlOnce ?? null);
    setSuccess(role === "off" ? "Share link revoked." : "A new one-time share link was created.");
  });

  return <section className="quire-review__section quire-share" aria-labelledby="share-title"
    data-review-live={live ? "true" : "false"}>
    <header className="quire-review__section-header">
      <div><h2 id="share-title">Share “{workspace.project.name}”</h2>
        <p>Named roles remain after link revocation. Reviewer links are never offered.</p></div>
    </header>
    <form className="quire-share__invite" onSubmit={event => {
      event.preventDefault();
      void mutate("invite", async () => {
        editorValue(await client.call(endpoints.invitationCreate, {
          params: { p: workspace.scope.projectId }, query: {},
          body: { email, role: inviteRole, expectedVersion: access.version },
          headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
        }));
        setEmail("");
      }, `Invitation sent to ${email}.`);
    }}>
      <Field label="Email to invite" type="email" required value={email}
        onChange={event => setEmail(event.currentTarget.value)}
        placeholder="coauthor@example.edu" />
      <label>Role<select value={inviteRole}
        onChange={event => {
          const role = event.currentTarget.value;
          if (role === "editor" || role === "reviewer" || role === "viewer") setInviteRole(role);
        }}>{reviewRoles.map(role => <option value={role} key={role}>{role}</option>)}</select></label>
      <Button variant="primary" type="submit" busy={busy === "invite"}>Invite</Button>
    </form>

    <WritableMembers props={props} access={access.data} version={access.version}
      reload={async () => { await Promise.all([load(), refreshWorkspace()]); }} />
    <ShareAccessLists props={props} access={access.data} busy={busy}
      mutate={mutate} onTransfer={setTransferUser} />

    <div className="quire-share__link">
      <div><h3>Link sharing</h3><p>{access.data.link.role === "off"
        ? "Only named people can open this project."
        : `The active link grants ${access.data.link.role} access until it is revoked.`}</p></div>
      <div className="quire-share__link-actions" role="group" aria-label="Link access">
        {(["off", "viewer", "editor"] as const).map(role => <Button key={role}
          variant={access.data.link.role === role ? "dark" : "neutral"}
          busy={busy === `link-${role}`} onClick={() => void setLink(role)}>
          {role === "off" ? "Off" : role === "viewer" ? "Anyone can view" : "Anyone can edit"}
        </Button>)}
      </div>
      {linkUrl && <div className="quire-share__copy"><label>One-time share link
        <input readOnly value={linkUrl} /></label><Button onClick={() => void run("copy-link", async () => {
          await navigator.clipboard.writeText(linkUrl); setSuccess("Share link copied.");
        })}>Copy link</Button></div>}
    </div>

    <footer className="quire-review__footer"><a href={`/projects/${workspace.scope.projectId}/git?branch=${encodeURIComponent(workspace.scope.branch)}`}>
      Share via Git instead</a><span className="quire-review__spacer" />
      <a className="q-button q-button--neutral q-button--regular"
        href={`/projects/${workspace.scope.projectId}/edit?branch=${encodeURIComponent(workspace.scope.branch)}`}>Done</a></footer>
    {error && <PanelMessage tone="error">{error}</PanelMessage>}
    {success && <PanelMessage tone="success">{success}</PanelMessage>}

    <Modal open={transferUser !== null} onClose={() => setTransferUser(null)}
      title="Transfer project ownership"
      description={transferUser ? `${transferUser.name} will become the owner. Your own role will be recalculated by the server.` : undefined}
      footer={<><Button onClick={() => setTransferUser(null)}>Cancel</Button>
        <Button variant="danger" busy={busy === "transfer"} onClick={() => {
          if (!transferUser) return;
          void run("transfer", async () => {
            editorValue(await client.call(endpoints.projectTransfer, {
              params: { p: workspace.scope.projectId }, query: {},
              body: { newOwnerId: transferUser.id, expectedVersion: access.version },
              headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
            }));
            setTransferUser(null);
            await refreshWorkspace();
            setSuccess(`Ownership transferred to ${transferUser.name}.`);
          });
        }}>Transfer ownership</Button></>}>
      <p>This changes who can manage sharing and project policy. It does not delete history.</p>
    </Modal>
  </section>;
}
