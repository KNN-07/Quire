import type { AiClaimFinding, Publication, SqlExecutor } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { isCodePointBoundary } from "../../core/base/unicode";
import type { Answer, RunRecord, SelectedFile } from "./model";
import { scopeOf } from "./model";
import type { AiStore } from "./store";

/** Provider assessments are data, not truth certificates or edit instructions. */
export function claimFindings(answer: Answer, files: readonly SelectedFile[], publications: readonly Publication[]): AiClaimFinding[] {
  return answer.findings.map(finding => {
    const file = files.find(item => item.id === finding.fileId && item.path === finding.path);
    if (!file || finding.from < file.from || finding.to > file.to || finding.from >= finding.to
      || !isCodePointBoundary(file.text, finding.from) || !isCodePointBoundary(file.text, finding.to)
      || file.text.slice(finding.from, finding.to) !== finding.quote) {
      throw new ServiceError("AI_FINDING_INVALID", 502, "Claim must exactly quote a nonempty UTF-16 range in the submitted source");
    }
    if (finding.citations.some(citation => !publications.some(publication =>
      publication.provider === citation.provider && publication.providerId === citation.providerId))) {
      throw new ServiceError("AI_CITATION_UNVERIFIED", 502, "Claim publication is not tied to this invocation's retrieval provenance");
    }
    return { ...finding, epoch: file.epoch, revision: file.revision };
  });
}

export async function currentClaimContext(store: AiStore, run: RunRecord, files: readonly SelectedFile[], db: SqlExecutor = store.context.db) {
  for (const file of files) {
    const entry = (await store.core(db).listFiles(scopeOf(run))).find(item => item.id === file.id);
    if (!entry || !entry.editable || entry.path !== file.path || entry.version.epoch !== file.epoch
      || entry.version.revision !== file.revision) {
      throw new ServiceError("AI_CONTEXT_STALE", 409, "Citation review source identity or version changed");
    }
    const current = await store.core(db).readDocument(scopeOf(run), file.id);
    if (current.file.path !== file.path || current.file.version.epoch !== file.epoch
      || current.file.version.revision !== file.revision || current.text !== file.text) {
      throw new ServiceError("AI_CONTEXT_STALE", 409, "Citation review source changed; request a new assessment");
    }
  }
}
