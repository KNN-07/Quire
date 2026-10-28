import * as Y from "yjs";
import type { Anchor } from "@quire/contracts";
import type { EditorDocument, SourceLocation, SourceSelection } from "../shared";

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

export function createAnchor(document: EditorDocument, selection: SourceSelection): Anchor {
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  const text = document.source.toJSON();
  if (from < 0 || to > text.length) throw new RangeError("Selection is outside the current source");
  return {
    fileId: document.file.id,
    epoch: document.getSnapshot().version.epoch,
    startRelative: encode(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(document.source, from))),
    endRelative: encode(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(document.source, to))),
    quote: text.slice(from, to),
  };
}

export function resolveAnchor(document: EditorDocument, anchor: Anchor): {
  readonly from: number;
  readonly to: number;
  readonly location: SourceLocation;
} | null {
  if (anchor.fileId !== document.file.id || anchor.epoch !== document.getSnapshot().version.epoch) return null;
  const start = Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(decode(anchor.startRelative)), document.ydoc,
  );
  const end = Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(decode(anchor.endRelative)), document.ydoc,
  );
  if (!start || !end || start.type !== document.source || end.type !== document.source || start.index > end.index) return null;
  const text = document.source.toJSON();
  if (text.slice(start.index, end.index) !== anchor.quote) return null;
  const preceding = text.slice(0, start.index).split("\n");
  return {
    from: start.index,
    to: end.index,
    location: {
      fileId: document.file.id,
      line: preceding.length,
      column: (preceding.at(-1)?.length ?? 0) + 1,
    },
  };
}
