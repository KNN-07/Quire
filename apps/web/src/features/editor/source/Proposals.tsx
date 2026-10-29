import { useEffect, useEffectEvent, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Suggestion } from "@quire/contracts";
import { editorValue } from "../shared";
import type { SourcePanelProps } from "../shared";
import { subscribeProjectEvents } from "../review/events";
import { resolveAnchor } from "../review/anchors";

/** Persisted read surface only; decisions remain in the existing Review consumer. */
export function SourceProposals({ client, workspace, document, refreshWorkspace }: SourcePanelProps) {
  const [proposals, setProposals] = useState<readonly Suggestion[]>([]);
  const [error, setError] = useState("");
  const refresh = useEffectEvent(refreshWorkspace);
  useEffect(() => {
    const controller = new AbortController();
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      const result = editorValue(await client.call(endpoints.suggestionsList, {
        params: { p: workspace.scope.projectId },
        query: { branch: workspace.scope.branch, fileId: document.file.id, status: "pending" },
        body: undefined, headers: workspace.requestHeaders,
      }, controller.signal));
      if (!controller.signal.aborted && request === sequence) { setProposals(result.items); setError(""); }
    };
    const report = (cause: unknown) => {
      if (controller.signal.aborted) return;
      if (!(cause instanceof Error)) throw cause;
      setError(cause.message);
    };
    const subscription = subscribeProjectEvents({ client, workspace,
      topics: new Set(["review.changed", "tree.changed"]), onOpen: () => { void load().catch(report); },
      onEvent: event => {
        void (event.topic === "tree.changed" ? Promise.all([refresh(), load()]) : load()).catch(report);
      },
    });
    void load().catch(report);
    void subscription.promise.catch(report);
    return () => { controller.abort(); subscription.dispose(); };
  }, [client, workspace.scope.projectId, workspace.scope.branch, workspace.requestHeaders["x-project-token"], document]);
  return <>{proposals.length > 0 && <details className="q-source-proposals" open>
    <summary>Pending proposals ({proposals.length}) · Accept or reject in Review</summary>
    {proposals.flatMap(proposal => proposal.edits.filter(edit => edit.fileId === document.file.id && edit.status === "pending").map(edit =>
      <article key={edit.id} data-source-proposal={proposal.id} data-author-id={proposal.authorId}>
        <strong>Proposed by {proposal.authorId === workspace.access.actorId ? "You" : `Collaborator ${proposal.authorId}`}</strong>
        <pre aria-label="Proposed source changes"><del>{edit.before}</del><ins>{edit.after}</ins></pre>
        {!resolveAnchor(document, edit.anchor) && <p>Anchor changed; this proposal cannot be applied to the displayed source without review.</p>}
      </article>))}
  </details>}{error && <p className="q-source-notice" role="alert">Proposals unavailable: {error}</p>}</>;
}
