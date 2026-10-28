import { expect, test } from "bun:test";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { FileEntry, Scope } from "@quire/contracts";
import type { DocumentSnapshot, EditorDocument } from "../../../apps/web/src/features/editor/shared";
import { createAnchor, resolveAnchor } from "../../../apps/web/src/features/editor/review";
import { fixtureIds as ids } from "../../fixtures/foundation";

function reviewDocument(text: string): EditorDocument {
  const ydoc = new Y.Doc();
  const source = ydoc.getText("source");
  source.insert(0, text);
  const file: FileEntry = {
    id: ids.mainFile, path: "main.tex", kind: "file", mime: "text/x-tex",
    blob: null, bytes: text.length, editable: true, version: { revision: 0, epoch: 0 }, link: null,
  };
  const snapshot: DocumentSnapshot = {
    version: file.version, persistence: { kind: "saved", revision: 0 },
    readOnly: false, readOnlyReason: null,
  };
  return {
    scope: { projectId: ids.project, branch: "main" } satisfies Scope,
    file, ydoc, source, awareness: new Awareness(ydoc),
    getSnapshot: () => snapshot, subscribe: () => () => {},
    replace: () => {}, flush: async () => {},
  };
}

test("keeps a UI anchor attached when source is inserted before it", () => {
  // Given: a selection encoded against the live Yjs source.
  const document = reviewDocument("alpha article omega");
  const anchor = createAnchor(document, { anchor: 6, head: 13 });
  // When: a collaborator inserts text before the selected quote.
  document.source.insert(0, "prefix\n");
  const resolved = resolveAnchor(document, anchor);
  // Then: the same quote resolves at its shifted line and column.
  expect(resolved).toMatchObject({ from: 13, to: 20, location: { line: 2, column: 7 } });
  document.awareness.destroy(); document.ydoc.destroy();
});

test("rejects an anchor after its document epoch changes", () => {
  // Given: an anchor from epoch zero.
  const document = reviewDocument("article");
  const anchor = createAnchor(document, { anchor: 0, head: 7 });
  const changed: EditorDocument = {
    ...document,
    getSnapshot: () => ({
      ...document.getSnapshot(), version: { revision: 1, epoch: 1 },
    }),
  };
  // When: restore has replaced the document epoch.
  const resolved = resolveAnchor(changed, anchor);
  // Then: the old anchor is not silently rebound.
  expect(resolved).toBeNull();
  document.awareness.destroy(); document.ydoc.destroy();
});
