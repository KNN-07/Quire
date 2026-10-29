import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { createAnchor } from "../review/anchors";
import type { EditorDocument, EditorWorkspace } from "../shared";
import { sourceOffset } from "./tex";

const draftSchema = z.object({
  enabled: z.boolean(), base: z.string(), text: z.string(), epoch: z.number().int().nonnegative(),
  submission: z.object({
    key: z.string(), body: endpoints.suggestionCreate.input.shape.body,
  }).nullable(),
});
export type SourceDraft = z.infer<typeof draftSchema>;
const retained = new Map<string, SourceDraft>();

/** Actor and scope are part of recovery identity; epoch stays in the record to expose conflicts. */
export function draftKey(workspace: EditorWorkspace, document: EditorDocument): string {
  return `quire.source-proposal.${workspace.access.actorId}.${workspace.scope.projectId}.${workspace.scope.branch}.${document.file.id}`;
}
export function freshDraft(document: EditorDocument, enabled: boolean): SourceDraft {
  const base = document.source.toJSON();
  return { enabled, base, text: base, epoch: document.getSnapshot().version.epoch, submission: null };
}
export function readDraft(key: string, document: EditorDocument): SourceDraft {
  const memory = retained.get(key);
  if (memory) return memory;
  const raw = sessionStorage.getItem(key);
  if (!raw) return freshDraft(document, false);
  // Do not erase an unreadable recovery record.
  return draftSchema.parse(JSON.parse(raw));
}
export function saveDraft(key: string, draft: SourceDraft): void {
  retained.set(key, draft);
  sessionStorage.setItem(key, JSON.stringify(draft));
}
export function draftConflict(document: EditorDocument, draft: SourceDraft): boolean {
  return document.getSnapshot().version.epoch !== draft.epoch || document.source.toJSON() !== draft.base;
}
/** A conservative single net replacement; boundaries never bisect a UTF-16 surrogate pair. */
export function draftChange(before: string, after: string) {
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  from = Math.min(sourceOffset(before, from), sourceOffset(after, from));
  let to = before.length;
  let end = after.length;
  while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end--; }
  if (sourceOffset(before, to) !== to || sourceOffset(after, end) !== end) { to++; end++; }
  return { from, to, before: before.slice(from, to), after: after.slice(from, end) };
}
export function proposalBody(document: EditorDocument, draft: SourceDraft, revision: number) {
  if (draftConflict(document, draft)) throw new Error("Source changed. Your draft is retained; copy it before starting from current source.");
  if (draft.text === draft.base) throw new Error("There are no draft changes to submit.");
  const change = draftChange(draft.base, draft.text);
  const anchor = createAnchor(document, { anchor: change.from, head: change.to });
  return {
    scope: document.scope, expectedVersion: revision,
    edits: [{ fileId: document.file.id, anchor, before: change.before, after: change.after, baseRevision: revision }],
  };
}
