import { useState } from "react";
import type { Artifact } from "@quire/contracts";
import type { EditorClient, EditorWorkspace } from "../shared";
import { useArtifact } from "./artifact";
import type { PdfDifference } from "./difference";

type DifferencePageProps = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly artifact: Artifact | null;
  readonly side: "from" | "to";
  readonly mode: PdfDifference["mode"];
  readonly region: PdfDifference["regions"][number] | undefined;
};
function DifferencePage({ client, workspace, artifact, side, mode, region }: DifferencePageProps) {
  const { data, error } = useArtifact({ client, workspace, artifact });
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(null);
  if (!artifact) return <p>No page in the {side === "from" ? "previous" : "next"} revision.</p>;
  return <figure className={`q-pdf-difference-page q-pdf-difference-page--${side}`}>
    <figcaption>{mode === "overlay" ? "Overlay of both revisions" : side === "from" ? "Previous revision" : "Next revision"}</figcaption>
    {error ? <p role="alert">{error}</p> : data ? <div className="q-pdf-difference-image">
      <img src={data.url} alt={`${side === "from" ? "Previous" : "Next"} compiled page`}
        onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
      {region && size && <span className="q-pdf-difference-region" aria-label="Rendered visual difference"
        style={{ left: `${region.x / size.width * 100}%`, top: `${region.y / size.height * 100}%`,
          width: `${region.width / size.width * 100}%`, height: `${region.height / size.height * 100}%` }} />}
    </div> : <p role="status">Loading rendered page…</p>}
  </figure>;
}
export function DifferencePages({ client, workspace, result, page }: {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly result: PdfDifference;
  readonly page: number;
}) {
  const image = (side: "from" | "to") => result.pages.find(artifact => {
    const match = new RegExp(`^${side}-(\\d+)\\.png$`).exec(artifact.name);
    return match?.[1] && Number(match[1]) === page;
  }) ?? null;
  const region = result.regions.find(item => item.page === page);
  return <div className={`q-pdf-body q-pdf-difference-pages q-pdf-difference-pages--${result.mode}`}>
    {(["from", "to"] as const).map(side => <DifferencePage key={`${side}-${page}`} client={client}
      workspace={workspace} artifact={image(side)} side={side} mode={result.mode} region={region} />)}
  </div>;
}
