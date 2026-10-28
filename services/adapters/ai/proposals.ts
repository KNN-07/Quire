import * as Y from "yjs";
import type { ProposedEdit } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { isCodePointBoundary } from "../../core/base/unicode";
import { newId } from "./model";
import type { Answer, SelectedFile } from "./model";

export function proposals(answer: Answer, files: readonly SelectedFile[]): readonly ProposedEdit[] {
  return answer.patches.map((patch, index) => {
    const file = files.find(item => item.id === patch.fileId && item.path === patch.path);
    if (!file || patch.path.startsWith("/") || patch.path.split("/").some(part => part === ".." || !part)
      || patch.from < file.from || patch.to > file.to || patch.to < patch.from
      || file.text.slice(patch.from, patch.to) !== patch.before || !patch.after.isWellFormed()
      || !isCodePointBoundary(file.text, patch.from) || !isCodePointBoundary(file.text, patch.to)) {
      throw new ServiceError("AI_PATCH_INVALID", 502, "Provider patch does not match an explicitly selected path, range and base text");
    }
    if (answer.patches.slice(0, index).some(other => other.fileId === patch.fileId
      && other.from <= patch.to && patch.from <= other.to)) {
      throw new ServiceError("AI_PATCH_OVERLAP", 502, "Provider patches overlap");
    }
    const document = new Y.Doc();
    try {
      Y.applyUpdate(document, Buffer.from(file.state, "base64"));
      const text = document.getText("source");
      return { id: newId(), fileId: file.id, before: patch.before, after: patch.after,
        baseRevision: file.revision, status: "pending" as const, anchor: {
          fileId: file.id, epoch: file.epoch, quote: patch.before,
          startRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, patch.from))).toString("base64"),
          endRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, patch.to))).toString("base64"),
        } };
    } finally { document.destroy(); }
  });
}
export function applyProposal(document: Y.Doc, edit: ProposedEdit): ProposedEdit | null {
  const text = document.getText("source");
  const start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(edit.anchor.startRelative, "base64")), document);
  const end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(edit.anchor.endRelative, "base64")), document);
  if (!start || !end || start.type !== text || end.type !== text || start.index > end.index
    || text.toJSON().slice(start.index, end.index) !== edit.before) return null;
  document.transact(() => { text.delete(start.index, end.index - start.index); text.insert(start.index, edit.after); });
  return { ...edit, before: edit.after, after: edit.before, anchor: { ...edit.anchor, quote: edit.after,
    startRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, start.index))).toString("base64"),
    endRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, start.index + edit.after.length))).toString("base64"),
  } };
}
