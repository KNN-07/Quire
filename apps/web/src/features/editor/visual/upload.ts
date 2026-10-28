import { endpoints } from "@quire/contracts";
import type { AuthoringProps, SourceEdit, SourceSelection } from "../shared";
import { editorValue } from "../shared";
import { VisualEditError } from "./model";
import { clipboardPng, figureCommand } from "./media";
import { parseDocument, selectionEdit, sourceRevision } from "./commands";
import type { ParsedLatex } from "./model";
import { packageEdit } from "../tools/insertion";

/** Upload bytes through the actual optimistic, scoped multipart endpoint. */
export async function uploadPng(props: AuthoringProps, file: File, signal: AbortSignal): Promise<string> {
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (file.type !== "image/png" || signature.join(",") !== "137,80,78,71,13,10,26,10") {
    throw new VisualEditError("INVALID_INPUT", "Paste one PNG image.");
  }
  await props.document.flush(signal);
  const access = editorValue(await props.client.call(endpoints.projectAccess, {
    params: { p: props.workspace.scope.projectId }, query: { branch: props.workspace.scope.branch },
    body: undefined, headers: props.workspace.requestHeaders,
  }, signal));
  if (!access.capabilities.edit || props.document.getSnapshot().readOnly) {
    throw new VisualEditError("INVALID_INPUT", "Project editing access changed.");
  }
  const path = `images/pasted-${crypto.randomUUID()}.png`;
  const body = new FormData();
  body.set("scope", JSON.stringify(props.workspace.scope));
  body.set("paths", JSON.stringify([path]));
  body.set("expectedVersion", String(access.branchRevision));
  body.append("files", file, path.split("/").at(-1));
  const files = editorValue(await props.client.call(endpoints.filesUpload, {
    params: { p: props.workspace.scope.projectId }, query: {}, body,
    headers: { ...props.workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
  }, signal));
  const uploaded = files.find(entry => entry.path === path);
  if (!uploaded) throw new VisualEditError("INVALID_INPUT", "The upload did not return the image file.");
  await props.refreshWorkspace();
  return uploaded.path;
}

/** Capture the source revision and selection before decoding or uploading. */
export async function prepareImagePaste(props: AuthoringProps, file: File, selection: SourceSelection,
  signal: AbortSignal): Promise<readonly SourceEdit[]> {
  const { document, workspace } = props;
  const snapshot = document.getSnapshot();
  if (snapshot.readOnly || !workspace.access.capabilities.edit) {
    throw new VisualEditError("INVALID_INPUT", "Source is read only.");
  }
  if (snapshot.persistence.kind !== "saved" && snapshot.persistence.kind !== "saving") {
    throw new VisualEditError("OFFLINE", "Reconnect before uploading an image.");
  }
  const parsed = parseDocument(document);
  const preamble = await figurePreamble(props, parsed, signal);
  const path = await uploadPng(props, await clipboardPng(file, signal), signal);
  signal.throwIfAborted();
  if (document.getSnapshot().readOnly || sourceRevision(document) !== parsed.revision) {
    throw new VisualEditError("STALE_RANGE", `Source changed during upload. Image saved as ${path}; insert it from project images.`);
  }
  return figureEdits(preamble, selectionEdit(selection, figureCommand(path)));
}

async function figurePreamble(props: AuthoringProps, parsed: ParsedLatex, signal: AbortSignal): Promise<SourceEdit | null> {
  const { document, workspace } = props;
  let preamble: SourceEdit | null = null;
  if (document.file.id === workspace.project.settings.mainFileId) {
    preamble = packageEdit(parsed.source, "graphicx");
  } else {
    const main = editorValue(await props.client.call(endpoints.fileDocument, {
      params: { p: workspace.scope.projectId, f: workspace.project.settings.mainFileId },
      query: { branch: workspace.scope.branch }, body: undefined, headers: workspace.requestHeaders,
    }, signal));
    if (packageEdit(main.text, "graphicx")) {
        throw new VisualEditError("INVALID_INPUT", `Add \\usepackage{graphicx} to ${main.file.path} before inserting here.`);
    }
  }
  return preamble;
}

function figureEdits(preamble: SourceEdit | null, target: SourceEdit): readonly SourceEdit[] {
  if (!preamble) return [target];
  if (preamble.from >= target.from && preamble.from <= target.to) {
    return [{ ...target, insert: preamble.insert + target.insert }];
  }
  return [preamble, target].sort((a, b) => a.from - b.from);
}

export async function prepareProjectFigure(props: AuthoringProps, path: string, selection: SourceSelection,
  signal: AbortSignal): Promise<readonly SourceEdit[]> {
  const parsed = parseDocument(props.document);
  const preamble = await figurePreamble(props, parsed, signal);
  signal.throwIfAborted();
  if (props.document.getSnapshot().readOnly || !props.workspace.access.capabilities.edit ||
    sourceRevision(props.document) !== parsed.revision) {
    throw new VisualEditError("STALE_RANGE", "Source changed. Select the image again.");
  }
  return figureEdits(preamble, selectionEdit(selection, figureCommand(path)));
}
