import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { assertNever, ProjectPathSchema } from "@quire/contracts";
import type { BlobStore, FileEntry, CompileSettings } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { sandbox, defaultLimits } from "./sandbox";
import type { Limits } from "./sandbox";
import { readTar } from "./archive";

export type BuildInput = {
  readonly files: readonly FileEntry[];
  readonly blobs: BlobStore;
  readonly settings: CompileSettings;
  readonly signal?: AbortSignal;
  readonly limits?: Limits;
  readonly unitId?: string;
};
export type BuildResult = {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly log: string;
  readonly success: boolean;
  readonly code: number;
  readonly unit: string;
};

export async function build(input: BuildInput): Promise<BuildResult> {
  if (input.files.reduce((total, file) => total + file.bytes, 0) > (input.limits ?? defaultLimits).workspaceBytes) {
    throw new ServiceError("SOURCE_LIMIT", 422, "Snapshot is larger than the compile workspace budget");
  }
  const root = await mkdtemp(join(tmpdir(), "quire-compiler-"));
  try {
    for (const file of input.files) {
      input.signal?.throwIfAborted();
      const path = join(root, ProjectPathSchema.parse(file.path));
      switch (file.kind) {
        case "folder": await mkdir(path, { recursive: true }); break;
        case "file":
          if (!file.blob) throw new ServiceError("SOURCE_MISSING", 422, file.path);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, await input.blobs.get(file.blob), { mode: 0o400 });
          break;
        default: assertNever(file.kind);
      }
    }
    const main = input.files.find((file) => file.id === input.settings.mainFileId);
    if (!main || main.kind !== "file" || !main.editable || main.link || !main.path.endsWith(".tex")) {
      throw new ServiceError("INVALID_MAIN", 422, "Main must be an editable unlinked .tex file");
    }
    const source = await Bun.file(join(root, main.path)).text();
    if (input.settings.engine !== "plain" && !/\\documentclass(?:\[.*?\])?\s*\{/.test(source)) {
      throw new ServiceError("INVALID_MAIN", 422, "Main must contain documentclass");
    }
    const projectRc = input.files.some((file) => file.path === ".latexmkrc") ? ".latexmkrc" :
      input.files.some((file) => file.path === "latexmkrc") ? "latexmkrc" : null;
    let engineFlags: readonly string[];
    switch (input.settings.engine) {
      case "pdflatex": engineFlags = ["-pdf"]; break;
      case "latex": engineFlags = ["-pdfdvi"]; break;
      case "xelatex": engineFlags = ["-xelatex"]; break;
      case "lualatex": engineFlags = ["-lualatex"]; break;
      case "plain": engineFlags = ["-pdf", "-pdflatex=pdftex %O %S"]; break;
      default: return assertNever(input.settings.engine);
    }
    const flags = [
      "-norc", ...(existsSync("/etc/LatexMk") ? ["-r", "/etc/LatexMk"] : []),
      "-e", '$dvipdf="dvipdfmx %O -o %D %S"',
      ...(projectRc ? ["-r", `/src/${projectRc}`] : []),
      ...engineFlags, "-interaction=nonstopmode", "-file-line-error",
      "-synctex=1", "-recorder", "-outdir=/work", "-jobname=output",
      "-latexoption=-no-shell-escape", ...(input.settings.stopOnFirstError ? ["-halt-on-error"] : []),
      ...(input.settings.draft ? ["-pretex=\\PassOptionsToPackage{draft}{graphicx}", "-usepretex"] : []),
    ];
    const result = await sandbox({
      source: root, limits: input.limits ?? defaultLimits,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.unitId ? { unitId: input.unitId } : {}),
      command: ["/bin/sh", "-c",
        'latexmk "$@" >&2; code=$?; if [ "$code" = 0 ]; then mkdir -p /work/.validation; pdfinfo /work/output.pdf >&2 && pdftoppm -scale-to 16 /work/output.pdf /work/.validation/page >&2 || code=65; fi; printf "%s" "$code" >/work/exit-code; cd /work; tar --format=ustar -cf - -- *; exit "$code"',
        "build", ...flags, `/src/${main.path}`],
    });
    const files = readTar(result.stdout);
    const pdf = files.get("output.pdf");
    return { files, log: result.stderr, success: !result.canceled && result.code === 0 && !!pdf &&
      new TextDecoder().decode(pdf.subarray(0, 5)) === "%PDF-", code: result.code, unit: result.unit };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
