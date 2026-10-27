import * as Y from "yjs";
import type { ProposedEdit } from "@quire/contracts";
import type { SourceDocument } from "./source-records";
import { fail } from "./store";
import { isCodePointBoundary } from "./unicode";

export function applyCopyEdits(document: SourceDocument, edits: readonly ProposedEdit[]): Uint8Array {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, Buffer.from(document.state, "base64"));
    const text = doc.getText("source");
    for (const edit of edits) {
      const start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(edit.anchor.startRelative, "base64")), doc);
      const end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(edit.anchor.endRelative, "base64")), doc);
      if (!start || !end || start.type !== text || end.type !== text || edit.anchor.epoch !== document.epoch
        || !isCodePointBoundary(text.toJSON(), start.index) || !isCodePointBoundary(text.toJSON(), end.index)
        || !edit.after.isWellFormed()
        || text.toJSON().slice(start.index, end.index) !== edit.before) fail("COPY_EDIT_CONFLICT", 409, "Pending suggestion no longer matches source");
      text.delete(start.index, end.index - start.index);
      text.insert(start.index, edit.after);
    }
    return new TextEncoder().encode(text.toJSON());
  } finally { doc.destroy(); }
}
