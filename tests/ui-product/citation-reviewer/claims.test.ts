import { expect, test } from "bun:test";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { AiClaimFindingSchema, FileEntrySchema, IdSchema } from "@quire/contracts";
import type { DocumentSnapshot, EditorDocument } from "../../../apps/web/src/features/editor/shared";
import { currentClaim } from "../../../apps/web/src/features/editor/assistant/claim-context";

test("native claim selection eligibility requires the identical file, epoch, durable revision and quote", () => {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  try {
    const source = ydoc.getText("source"); source.insert(0, "😀 exact claim.");
    const file = FileEntrySchema.parse({ id: crypto.randomUUID(), path: "main.tex", kind: "file", mime: "text/plain",
      blob: null, bytes: 0, editable: true, version: { revision: 4, epoch: 2 }, link: null });
    let snapshot: DocumentSnapshot = { version: file.version, persistence: { kind: "saved", revision: 4 },
      readOnly: false, readOnlyReason: null };
    const document: EditorDocument = { scope: { projectId: IdSchema.parse(crypto.randomUUID()), branch: "main" }, file,
      source, ydoc, awareness, getSnapshot: () => snapshot, subscribe: () => () => {},
      replace: () => { throw new Error("Highlight must never edit source"); }, flush: async () => {} };
    const finding = AiClaimFindingSchema.parse({ fileId: file.id, path: file.path, from: 3, to: 15,
      quote: "exact claim.", assessment: "unsupported", explanation: "Insufficient evidence", citations: [], revision: 4, epoch: 2 });
    expect(currentClaim(finding, document)).toBe(true);
    expect(currentClaim(finding, null)).toBe(false);
    expect(currentClaim({ ...finding, fileId: IdSchema.parse(crypto.randomUUID()) }, document)).toBe(false);
    expect(currentClaim({ ...finding, path: "other.tex" }, document)).toBe(false);
    snapshot = { ...snapshot, version: { revision: 5, epoch: 2 } };
    expect(currentClaim(finding, document)).toBe(false);
    snapshot = { ...snapshot, version: { revision: 4, epoch: 3 } };
    expect(currentClaim(finding, document)).toBe(false);
    snapshot = { ...snapshot, version: file.version, persistence: { kind: "saving", acknowledgedRevision: 4, pendingUpdates: 1 } };
    expect(currentClaim(finding, document)).toBe(false);
    snapshot = { ...snapshot, persistence: { kind: "saved", revision: 4 } };
    source.insert(0, "prefix ");
    expect(currentClaim(finding, document)).toBe(false);
  } finally { awareness.destroy(); ydoc.destroy(); }
});
