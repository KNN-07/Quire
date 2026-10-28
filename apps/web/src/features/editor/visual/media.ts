import type { FileEntry } from "@quire/contracts";
import { VisualEditError } from "./model";

/** Deliberately excludes TeX metacharacters, absolute paths and traversal. */
export function figurePath(path: string): string {
  if (!/^[a-zA-Z0-9_-]+(?:[./][a-zA-Z0-9_-]+)*$/.test(path) ||
    !/\.(?:png|jpe?g|pdf|eps)$/i.test(path)) {
    throw new VisualEditError("INVALID_INPUT", "Use a project-relative PNG, JPEG, PDF or EPS path with letters, numbers, dots, underscores and hyphens.");
  }
  return path;
}

export function projectFigure(file: FileEntry): boolean {
  try { figurePath(file.path); return file.kind === "file"; }
  catch { return false; }
}

export function assertGraphicBytes(path: string, bytes: Uint8Array): void {
  figurePath(path);
  const extension = path.split(".").at(-1)?.toLowerCase();
  const prefix = new TextDecoder("ascii").decode(bytes.subarray(0, 16));
  const valid = extension === "png" ? bytes.subarray(0, 8).join(",") === "137,80,78,71,13,10,26,10" :
    extension === "jpg" || extension === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
    extension === "pdf" ? prefix.startsWith("%PDF-") : prefix.startsWith("%!PS");
  if (!valid) throw new VisualEditError("INVALID_INPUT", `Image bytes do not match ${path}. Choose the correct PNG, JPEG, PDF or EPS extension.`);
}

export function figureCommand(path: string, caption = "", label = "", width = "0.8"): string {
  figurePath(path);
  if (!/^(?:0?\.\d+|1(?:\.0+)?)$/.test(width) || Number(width) <= 0 || Number(width) > 1) {
    throw new VisualEditError("INVALID_INPUT", "Choose a width greater than zero and at most one.");
  }
  if (!/^[a-zA-Z0-9_:./+-]*$/.test(label)) {
    throw new VisualEditError("INVALID_INPUT", "Use a label without spaces or TeX commands.");
  }
  return `\n\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=${width}\\linewidth]{${path}}\n\\caption{${caption}}\n\\label{${label}}\n\\end{figure}\n`;
}

export function clipboardImage(data: { readonly items: Iterable<Pick<DataTransferItem, "kind" | "getAsFile">> }): File | null {
  const files = Array.from(data.items).filter(item => item.kind === "file");
  if (!files.length) return null;
  const file = files[0]?.getAsFile();
  if (files.length !== 1 || !file || !/^image\/(?:png|jpeg|gif|webp|bmp)$/.test(file.type)) {
    throw new VisualEditError("INVALID_INPUT", "Paste exactly one PNG, JPEG, GIF, WebP or BMP image. SVG and multiple files are not supported.");
  }
  return file;
}

/** Clipboard conversion is explicit; device uploads never pass through this function. */
export async function clipboardPng(file: File, signal: AbortSignal): Promise<File> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const png = bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const text = new TextDecoder("ascii").decode(bytes);
  const valid = file.type === "image/png" ? png : file.type === "image/jpeg" ? jpeg :
    file.type === "image/gif" ? /^GIF8[79]a/.test(text) :
    file.type === "image/webp" ? text.startsWith("RIFF") && text.slice(8, 12) === "WEBP" :
    file.type === "image/bmp" && text.startsWith("BM");
  if (!valid || file.size > 20 * 1024 * 1024) {
    throw new VisualEditError("INVALID_INPUT", "Paste a valid supported image no larger than 20 MiB.");
  }
  signal.throwIfAborted();
  // Decode even PNGs so a signature alone cannot masquerade as an image.
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) {
      throw new VisualEditError("INVALID_INPUT", "Clipboard images are limited to 40 million pixels.");
    }
    signal.throwIfAborted();
    if (png) return file;
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new VisualEditError("INVALID_INPUT", "Image conversion is unavailable in this browser.");
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
      if (value) resolve(value); else reject(new VisualEditError("INVALID_INPUT", "Image conversion failed."));
    }, "image/png"));
    signal.throwIfAborted();
    return new File([blob], "clipboard.png", { type: "image/png" });
  } finally { bitmap.close(); }
}
