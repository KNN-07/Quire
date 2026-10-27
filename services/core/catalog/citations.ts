import { FileEntrySchema } from "@quire/contracts";
import type { Id, Scope, Publication } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { projects, newId, fail } from "./storage";
import { parseBibtex, singleRecord } from "./bibtex";

export async function cite(context: ModuleContext, actorId: Id, input: {
  readonly scope: Scope; readonly publication: Publication; readonly targetFileId?: Id | undefined;
  readonly command: "cite" | "citet" | "citep"; readonly expectedVersion: number;
}) {
  const service = projects(context);
  const record = singleRecord(input.publication.bibtex);
  return service.serialized(input.scope, async () => {
    await service.authorize(actorId, input.scope, "files.write");
    const files = service.listFiles(input.scope);
    const candidates = files.filter(file => file.path.toLowerCase().endsWith(".bib") && file.kind === "file" && file.editable && !file.link);
    let target = input.targetFileId ? service.getFile(input.scope, input.targetFileId) : candidates[0];
    if (!input.targetFileId && candidates.length > 1) fail("TARGET_REQUIRED", 409, "Select an editable bibliography");
    if (target && (!target.path.toLowerCase().endsWith(".bib") || !target.editable || target.link || target.kind !== "file")) {
      fail("READ_ONLY_BIBLIOGRAPHY", 403, "Citation target must be an editable unlinked .bib file");
    }
    if (!target) {
      if (files.some(file => file.path === "references.bib")) fail("TARGET_REQUIRED", 409, "references.bib is not an editable bibliography");
      target = FileEntrySchema.parse({ id: newId(), path: "references.bib", kind: "file", mime: "text/plain",
        bytes: 0, blob: null, editable: true, link: null, version: { revision: 0, epoch: 0 } });
    }
    const text = target.blob ? service.readDocument(input.scope, target.id).text : "";
    const existing = text.trim() ? parseBibtex(text).find(entry => entry.citationKey === record.citationKey) : undefined;
    if (existing && existing.bibtex !== record.bibtex) fail("CITATION_KEY_CONFLICT", 409, "Citation key already names a different record");
    const bytes = new TextEncoder().encode(existing ? text : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${record.bibtex}\n`);
    const targetId = target.id;
    const inputs = files.filter(file => file.id !== targetId).map(file => ({ file }));
    await service.commitSource({ actorId, scope: input.scope, expectedRevision: input.expectedVersion,
      inputs: [...inputs, { file: target, bytes }] });
    return service.getFile(input.scope, targetId);
  });
}
