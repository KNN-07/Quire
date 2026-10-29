import type { AiClaimFinding } from "@quire/contracts";
import type { EditorDocument } from "../shared";

export function currentClaim(finding: AiClaimFinding, document: EditorDocument | null): boolean {
  if (!document || document.file.id !== finding.fileId || document.file.path !== finding.path) return false;
  const snapshot = document.getSnapshot();
  return snapshot.persistence.kind === "saved" && snapshot.version.epoch === finding.epoch
    && snapshot.version.revision === finding.revision
    && document.source.toJSON().slice(finding.from, finding.to) === finding.quote;
}
